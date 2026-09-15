"""Run an NLP++ analyzer the studio sends, and say what happened.

    result = run({"spec/analyzer.seq": "...", "spec/rules.nlp": "...", ...}, "some text")

ONE PROCESS PER RUN. Each run gets a fresh Python process (child.py) and its own
temporary analyzer folder. That is what makes a run safe to stop and safe to fail:
the engine caches analyzers by name for the life of its process, an NLP++ loop can
run forever, and some mistakes stop the engine outright (adding an attribute to an
analyzer with no base knowledge base is one). A process of its own is killed at
the timeout, crashes alone, and takes its cache with it. Starting one costs about
half a second, most of it NLPPlus copying its bundled analyzers on import.

WHAT COMES BACK is read from the files the engine leaves, not from NLPPlus's
Results, which reads them in the platform's encoding where the engine writes UTF-8:

    output/final.tree    the parse tree              -> "tree"
    logs/make_ana.log    errors building the rules   -> "problems"
    output/err.log       errors running them         -> "problems"
    output/*             what the analyzer wrote     -> "output"
    stdout               the engine's own messages   -> "log"

A problem line is "<pass> <line> [message]". The pass number maps back to a spec/
file the way the engine numbers analyzer.seq, which is also how the page numbers
it (studio/src/analyzers.ts passes()).

NOT A SANDBOX. NLP++ can run shell commands and read and write files. The calls
that reach outside the analyzer on purpose -- system(), urltofile(), the db*()
family and a few more (BLOCKED) -- are refused before anything runs. The file
functions (openfile, readfile, mkdir, ...) are not: the knowledge-base library
every template ships uses them. Serving strangers therefore also needs the
operating system to contain the process; see docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHILD = HERE / "child.py"

# The analyzer's folder name inside a run. Every run has its own process, so one
# fixed name never meets the engine's by-name cache twice.
ANALYZER = "analyzer"

# child.py prints this once the engine has returned. No marker means the process
# died inside the engine.
DONE = "@@nlp-studio-run-done@@"

# "cpu seconds,largest file MB,address space MB", for child.py to apply on POSIX.
LIMITS_ENV = "NLP_STUDIO_RUN_LIMITS"

MB = 1024 * 1024
DEFAULT_TIMEOUT = 10.0
DEFAULT_MEMORY_MB = 2048
MAX_WRITE_MB = 64
MAX_FILES = 2000
MAX_FILES_BYTES = 8 * MB
MAX_TEXT_BYTES = 1 * MB
MAX_TREE_BYTES = 4 * MB
MAX_OUTPUT_FILES = 50
MAX_OUTPUT_FILE_BYTES = 256 * 1024
MAX_LOG_LINES = 300

# Built-ins whose whole purpose is to reach past the analyzer: a shell, the
# network, a database, the desktop app's dialogs, deleting and unpacking files.
BLOCKED = frozenset({
    "system", "urltofile", "resolveurl", "deletefile", "unpackdirs", "batchstart",
    "interactive", "exittopopup", "getpopupdata",
    "dbopen", "dballocstmt", "dbbindcol", "dbclose", "dbexec", "dbexecstmt", "dbfetch", "dbfreestmt",
})

# Files the engine writes into output/ for itself; everything else there is the analyzer's.
ENGINE_OUTPUT = frozenset({"dbg.log", "err.log", "final.tree", "def.log", "init.log"})

_SEGMENT = r"[A-Za-z0-9 _.,()&+@'\-]+"
_PATH = re.compile(rf"^(spec|kb|input)(/{_SEGMENT})+$")
_RESERVED = frozenset({"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))})

_LOG_LINE = re.compile(r"^\s*(\d+)\s+(\d+)\s+\[(.*)\]\s*$")
_NOT_A_PROBLEM = re.compile(r"^(Date:|[\w ]+ time=)")
_LOG_PREFIX = re.compile(r"^\d+ \d+ ")
_NOISE = re.compile(
    r"^\[(logfile|rfbdir|rfb file|log file|spec directory|spec file|analyzer directory|analyzer name|"
    r"output directory|creating output directory|loaded analyzer|reusing loaded analyzer|bind_sys|"
    r"after vtrun|exec analyzer time|pass \d+ time)", re.I)
_SECRET = re.compile(r"TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE", re.I)

# An escaped character, a string, a block comment or a line comment. Strings and
# comments are blanked before looking for calls; escapes are kept, so "\#" in a
# rule does not start a comment that would hide the rest of its line.
_NOT_CODE = re.compile(r'\\.|"(?:\\.|[^"\\\n])*"|/\*.*?\*/|#[^\n]*', re.S)
_CALL = re.compile(r"(?<![\w$])([A-Za-z_]\w*)\s*\(")


class RunError(ValueError):
    """A request no analyzer could make: the server answers 400 and runs nothing."""


def validate(files: object, text: object) -> None:
    if not isinstance(files, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in files.items()):
        raise RunError("files must be an object of path to text.")
    if not isinstance(text, str):
        raise RunError("text must be a string.")
    if len(files) > MAX_FILES:
        raise RunError(f"An analyzer may have at most {MAX_FILES} files here.")
    total = 0
    for path, body in files.items():
        segments = path.split("/")
        if (not _PATH.match(path)
                or any(s in (".", "..") or s != s.strip() or s.split(".")[0].upper() in _RESERVED for s in segments)):
            raise RunError(f"Not a path an analyzer file can have: {path!r}")
        total += len(body.encode("utf-8"))
    if total > MAX_FILES_BYTES:
        raise RunError(f"The analyzer's files come to more than {MAX_FILES_BYTES // MB} MB.")
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise RunError(f"The input text is more than {MAX_TEXT_BYTES // MB} MB.")
    if "spec/analyzer.seq" not in files:
        raise RunError("An analyzer needs spec/analyzer.seq.")


def pass_files(seq: str, paths) -> dict[int, str | None]:
    """Pass number -> its spec/ file (None for tokenize and other built-in passes).

    A folder, a stub and an "end" line take no number. A switched-off pass
    ("/nlp name") keeps its number: the engine counts it, so an error in the pass
    after it is reported one higher. Same numbering as the page's passes().
    """
    have = set(paths)
    out: dict[int, str | None] = {}
    n = 0
    for raw in seq.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("/*"):
            continue
        parts = line.lstrip("/").split("#", 1)[0].split()
        if not parts or parts[0] in ("end", "folder", "stub"):
            continue
        n += 1
        name = parts[1] if len(parts) > 1 else ""
        out[n] = next((f for f in (f"spec/{name}.nlp", f"spec/{name}.pat") if f in have), None)
    return out


def parse_log(text: str | None, pass_file: dict[int, str | None]) -> list[dict]:
    """Problems from make_ana.log or err.log: lines of "<pass> <line> [message]"."""
    problems = []
    for raw in (text or "").splitlines():
        m = _LOG_LINE.match(raw)
        if not m:
            continue
        number, line, message = int(m[1]), int(m[2]), m[3].strip()
        if not message or _NOT_A_PROBLEM.match(message):
            continue
        problems.append({"file": pass_file.get(number) if number else None, "pass": number, "line": line, "message": message})
    return problems


def blocked_calls(files: dict[str, str], pass_file: dict[int, str | None]) -> list[dict]:
    """A problem for every call of a BLOCKED built-in in a pass file."""
    number = {f: n for n, f in pass_file.items() if f}
    found = []
    for path, text in sorted(files.items()):
        if not path.startswith("spec/") or not path.lower().endswith((".nlp", ".pat")):
            continue
        code = _NOT_CODE.sub(lambda m: m[0] if m[0].startswith("\\") else re.sub(r"[^\n]", " ", m[0]), text)
        for m in _CALL.finditer(code):
            if m[1].lower() in BLOCKED:
                found.append({
                    "file": path, "pass": number.get(path, 0), "line": code.count("\n", 0, m.start()) + 1,
                    "message": f"{m[1]}() is not allowed on the run server.",
                })
    return found


def engine_log(stdout: str) -> list[str]:
    lines = []
    for raw in stdout.splitlines():
        line = _LOG_PREFIX.sub("", raw.strip())
        if line and line != DONE and not _NOISE.match(line):
            lines.append(line)
    return lines[-MAX_LOG_LINES:]


def run(files: dict[str, str], text: str, *, python: str = sys.executable, timeout: float = DEFAULT_TIMEOUT,
        memory_mb: int = DEFAULT_MEMORY_MB, tmp_root: str | None = None) -> dict:
    """Run the analyzer in `files` over `text`. Raises RunError for a bad request."""
    started = time.monotonic()
    validate(files, text)
    pass_file = pass_files(files["spec/analyzer.seq"], files)

    blocked = blocked_calls(files, pass_file)
    if blocked:
        names = sorted({p["message"].split("()")[0] for p in blocked})
        return _result("rejected", f"Not run: the run server does not allow {', '.join(n + '()' for n in names)}.",
                       started, problems=blocked)

    run_dir = Path(tempfile.mkdtemp(prefix="nlp-run-", dir=tmp_root))
    try:
        ana = run_dir / "analyzers" / ANALYZER
        for path, body in files.items():
            target = ana.joinpath(*path.split("/"))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body.encode("utf-8"))
        for sub in ("output", "logs", "kb/user"):
            (ana / sub).mkdir(parents=True, exist_ok=True)
        tmp = run_dir / "tmp"
        tmp.mkdir()

        try:
            proc = subprocess.Popen(
                [python, str(CHILD), str(run_dir / "analyzers"), ANALYZER],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                cwd=run_dir, env=_child_env(tmp, timeout, memory_mb), start_new_session=os.name == "posix")
        except OSError as err:
            return _result("crashed", f"Could not start the engine's process: {err}.", started)
        try:
            out, _ = proc.communicate(text.encode("utf-8"), timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill(proc)
            out, _ = proc.communicate()
            return _result("timeout", f"Stopped after {timeout:g} s without finishing. Look for a loop that never ends.",
                           started, log=engine_log(_decode(out)))

        stdout = _decode(out)
        log = engine_log(stdout)
        problems = (parse_log(_read(ana / "logs" / "make_ana.log"), pass_file)
                    + parse_log(_read(ana / "output" / "err.log"), pass_file))
        if DONE not in stdout:
            detail = f": {log[-1]}" if log else ""
            return _result("crashed", f"The engine stopped ({_exit_status(proc.returncode)}){detail}", started,
                           problems=problems, log=log)
        if any(line.startswith("[Couldn't build analyzer") for line in log):
            return _result("failed", "The analyzer did not build. See Problems.", started, problems=problems, log=log)

        message = "Ran." if not problems else f"Ran, and reported {len(problems)} problem{'s' if len(problems) != 1 else ''}."
        return _result("ok", message, started, problems=problems, log=log,
                       output=_outputs(ana / "output"), tree=_read(ana / "output" / "final.tree", MAX_TREE_BYTES) or None)
    finally:
        shutil.rmtree(run_dir, ignore_errors=True)


def _result(status: str, message: str, started: float, **extra) -> dict:
    result = {"status": status, "message": message, "ms": round((time.monotonic() - started) * 1000),
              "problems": [], "log": [], "output": {}, "tree": None}
    result.update(extra)
    return result


def _child_env(tmp: Path, timeout: float, memory_mb: int) -> dict[str, str]:
    # The analyzer never needs the server's credentials; its temporary files go
    # inside the run folder, so they are deleted with it.
    env = {k: v for k, v in os.environ.items() if not _SECRET.search(k)}
    env.update(TMP=str(tmp), TEMP=str(tmp), TMPDIR=str(tmp), PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
    env[LIMITS_ENV] = f"{int(timeout) + 2},{MAX_WRITE_MB},{memory_mb}"
    return env


def _kill(proc: subprocess.Popen) -> None:
    try:
        if os.name == "posix":
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError, OSError):
        pass


def _exit_status(code: int | None) -> str:
    if code is None:
        return "no exit code"
    if code < 0:
        return f"signal {-code}"
    if code > 255:
        return f"exit code 0x{code & 0xFFFFFFFF:08X}"
    return f"exit code {code}"


def _decode(data: bytes | None) -> str:
    return (data or b"").decode("utf-8", "replace")


def _read(path: Path, limit: int = 1 * MB) -> str | None:
    if not path.is_file():
        return None
    with open(path, "rb") as fh:
        return fh.read(limit).decode("utf-8", "replace")


def _outputs(out_dir: Path) -> dict[str, str]:
    output: dict[str, str] = {}
    if not out_dir.is_dir():
        return output
    for path in sorted(out_dir.rglob("*")):
        rel = path.relative_to(out_dir).as_posix()
        if not path.is_file() or rel in ENGINE_OUTPUT:
            continue
        if len(output) >= MAX_OUTPUT_FILES:
            break
        size = path.stat().st_size
        with open(path, "rb") as fh:
            data = fh.read(MAX_OUTPUT_FILE_BYTES)
        if b"\0" in data[:4096]:
            output[rel] = f"(a binary file, {size} bytes)"
            continue
        text = data.decode("utf-8", "replace")
        if size > MAX_OUTPUT_FILE_BYTES:
            text += f"\n... ({size} bytes in all; the rest is not shown)"
        output[rel] = text
    return output
