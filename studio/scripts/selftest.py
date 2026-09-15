"""Open a build of the studio in a headless browser and wait for its own checks.

    npm run build && npm run selftest          (or: python scripts/selftest.py dist)

Serves the folder, opens index.html?selftest in headless Edge or Chrome, and waits
for the page to POST what src/selftest.ts found. Exits 0 only when every check
passed. BROWSER=<path> picks the browser; otherwise the usual install paths are
tried.

RUN CHECKS. It also starts the run server (server/app.py) with the Python running
this script -- or NLP_PYTHON -- and passes the page's /api/ requests through to it,
so the page checks running an analyzer too. That Python needs NLPPlus
(server/requirements.txt). Without it, or with --no-server, the run checks are
skipped and this says so.

The page is served over http, not opened from disk: a Web Worker cannot start from
a file:// page, and the language server is one.
"""
import argparse
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

STUDIO = Path(__file__).resolve().parents[1]
CANDIDATES = [
    os.environ.get("BROWSER", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def print_tail(title: str, path: str, keep=lambda line: True, n: int = 30) -> None:
    """The last lines of a log worth reading, for when the page never answered."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = [line.rstrip() for line in fh if keep(line)]
    except OSError:
        return
    print(f"\n{title} (last {min(n, len(lines))} of {len(lines)} lines):")
    for line in lines[-n:]:
        print(f"  {line[:300]}")


def stand_in_github():
    """A fake GitHub holding the studio's sample twice -- in a folder, and deeper -- for the GitHub checks."""
    sys.path.insert(0, str(STUDIO / "server"))
    from fake_github import FakeGitHub
    sample = STUDIO / "samples" / "hello-studio"
    files = {p.relative_to(sample).as_posix(): p.read_text(encoding="utf-8", errors="replace")
             for p in sorted(sample.rglob("*")) if p.is_file() and p.relative_to(sample).parts[0] in ("spec", "kb", "input")}
    repo = {"README.md": "# analyzers\n"}
    for folder in ("samples/hello-studio", "nested/deep/hello"):
        repo.update({f"{folder}/{path}": text for path, text in files.items()})
    return FakeGitHub({"acme/analyzers": repo}, login="selftest", app=False).start()


def start_run_server(python: str, github=None):
    """(process, url) for a running run server, or (None, why there is none)."""
    probe = subprocess.run([python, "-c", "import importlib.metadata as m; print(m.version('NLPPlus'))"],
                           capture_output=True, text=True)
    if probe.returncode != 0:
        return None, f"NLPPlus is not installed for {python}; set NLP_PYTHON"
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ)
    if github:
        # The development token path: GitHub calls with no sign-in (the sign-in redirects
        # themselves are covered by server/test_github.py).
        env.update(NLP_STUDIO_GITHUB_TOKEN=github.token, NLP_STUDIO_GITHUB_API=github.url, NLP_STUDIO_GITHUB_WEB=github.url)
    # Its output is kept, and shown if the page never answers.
    log_path = os.path.join(tempfile.gettempdir(), f"nlp-studio-selftest-server-{port}.log")
    log = open(log_path, "wb")
    proc = subprocess.Popen([python, str(STUDIO / "server" / "app.py"), "--port", str(port), "--quiet"],
                            stdout=log, stderr=subprocess.STDOUT, env=env)
    proc.log_path = log_path
    url = f"http://127.0.0.1:{port}"
    deadline = time.time() + 60
    while time.time() < deadline and proc.poll() is None:
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=2):
                return proc, url
        except OSError:
            time.sleep(0.2)
    proc.kill()
    return None, "the run server did not start"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check a studio build in a headless browser.")
    parser.add_argument("dist", nargs="?", default="dist")
    parser.add_argument("--no-server", action="store_true", help="skip the run checks")
    args = parser.parse_args()

    root = os.path.abspath(args.dist)
    if not os.path.isfile(os.path.join(root, "index.html")):
        print(f"selftest: no index.html in {root} -- run npm run build first")
        return 2
    browser = next((c for c in CANDIDATES if c and os.path.exists(c)), None)
    if not browser:
        print("selftest: no Edge or Chrome found; set BROWSER")
        return 2

    github = None
    if args.no_server:
        run_proc, run_url = None, "--no-server"
    else:
        github = stand_in_github()
        run_proc, run_url = start_run_server(os.environ.get("NLP_PYTHON") or sys.executable, github)
    if not run_proc:
        print(f"selftest: run checks skipped ({run_url})")

    result: dict = {}
    started = [time.time()]

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=root, **k)

        def log_message(self, *a):
            pass

        def _proxy(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None
            request = urllib.request.Request(run_url + self.path, data=body, method=self.command,
                                             headers={"Content-Type": self.headers.get("Content-Type", "application/json")})
            try:
                with urllib.request.urlopen(request, timeout=120) as res:
                    code, data = res.status, res.read()
            except urllib.error.HTTPError as err:
                code, data = err.code, err.read()
            except OSError:
                code, data = 502, b'{"status": "unavailable", "message": "The run server went away."}'
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if run_proc and self.path.startswith("/api/"):
                return self._proxy()
            super().do_GET()

        def do_POST(self):
            if run_proc and self.path.startswith("/api/"):
                return self._proxy()
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            if self.path.startswith("/selftest-progress"):
                # How far the page has got; shown if it never sends its result.
                step = body.decode("utf-8", "replace")
                result.setdefault("steps", []).append(f"{time.time() - started[0]:6.1f}s  {step}")
            else:
                result["data"] = json.loads(body or b"{}")
            self.send_response(204)
            self.end_headers()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html?selftest={'run' if run_proc else '1'}"
    # GitHub's Ubuntu runners restrict the user namespaces Chrome's sandbox needs.
    sandbox = ["--no-sandbox"] if os.environ.get("CI") else []
    # How long the page may take to say its script started before the browser is started
    # again. On GitHub's runners Chrome's network service has crashed just after startup
    # ("Network service crashed or was terminated, restarting service") and taken the first
    # page load with it, so the page never ran at all; a fresh browser loads it.
    page_wait = float(os.environ.get("NLP_STUDIO_SELFTEST_PAGE_WAIT", "30"))
    profiles: list[str] = []
    # The browser's log carries the page's console messages and errors, across restarts.
    browser_log = tempfile.NamedTemporaryFile(prefix="nlp-studio-selftest-browser-", suffix=".log", delete=False)

    def launch() -> subprocess.Popen:
        profile = tempfile.mkdtemp(prefix="nlp-studio-selftest-")
        profiles.append(profile)
        return subprocess.Popen(
            [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", *sandbox,
             "--enable-logging=stderr", "--v=0", f"--user-data-dir={profile}", "--window-size=1280,900", url],
            stdout=subprocess.DEVNULL, stderr=browser_log)

    def stop(process: subprocess.Popen) -> None:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True)
        else:
            process.kill()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass

    proc = launch()
    start = started[0] = launched = time.time()
    restarts = 0
    try:
        while "data" not in result and time.time() - launched < 120:
            if not result.get("steps") and time.time() - launched > page_wait and restarts < 2:
                restarts += 1
                print(f"selftest: the page did not start within {page_wait:g}s; "
                      f"starting the browser again ({restarts} of 2)", flush=True)
                stop(proc)
                # Only the new browser's progress counts: a report the old one sent as it
                # died must not pass for the new page having started.
                result.pop("steps", None)
                proc = launch()
                launched = started[0] = time.time()
            time.sleep(0.25)
    finally:
        stop(proc)
        if run_proc:
            if os.name == "nt":
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(run_proc.pid)], capture_output=True)
            else:
                run_proc.kill()
        if github:
            github.stop()
        server.shutdown()
        for profile in profiles:
            shutil.rmtree(profile, ignore_errors=True)

    data = result.get("data")
    if not data:
        print(f"selftest: no result from the page after {time.time() - start:.0f}s")
        steps = result.get("steps", [])
        print(f"\nhow far the page got ({len(steps)} steps):" if steps else "\nthe page reported no progress at all")
        for line in steps[-25:]:
            print(f"  {line}")
        browser_log.close()
        print_tail("browser console and errors", browser_log.name,
                   lambda line: "CONSOLE" in line or "ERROR" in line or "Uncaught" in line)
        if run_proc:
            print_tail("run server", run_proc.log_path)
        return 1
    for c in data["checks"]:
        print(f"{'ok ' if c['ok'] else 'BAD'} | {c['name']:<70} | {json.dumps(c['got'])[:120]}")
    passed = sum(1 for c in data["checks"] if c["ok"])
    print(f"\nselftest: {passed}/{len(data['checks'])} passed in {time.time() - start:.1f}s")
    return 0 if data["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
