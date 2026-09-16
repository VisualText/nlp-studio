"""Parse trees from recent runs, kept a while so the page can open them one at a time.

A run's trees can be very large -- in debug mode the engine writes one after every pass,
and a big analyzer's come to tens of megabytes -- so they do not travel in the run's
result. The result lists them; the page asks for one when it is opened, and shows it in
the editor (GET /api/run/tree in app.py).

They are kept on disk, under one folder, for KEEP_SECONDS, for at most MAX_RUNS runs and
MAX_BYTES bytes; the oldest go first, and one run may take no more than half the space. A
run's trees are found by a random id, and read only by whoever ran it: the same signed-in
login, or anyone when the server has no sign-in.
"""
from __future__ import annotations

import re
import secrets
import shutil
import tempfile
import threading
import time
from pathlib import Path

# final.tree, and ana001.tree ... -- one per pass, in debug mode.
TREE_NAME = re.compile(r"^(final|ana\d{3,})\.tree$")


class TreeStore:
    KEEP_SECONDS = 30 * 60
    MAX_RUNS = 20
    MAX_BYTES = 256 * 1024 * 1024

    def __init__(self, root: str | Path | None = None, *, keep_seconds: float | None = None,
                 max_runs: int | None = None, max_bytes: int | None = None):
        self.root = Path(root) if root else Path(tempfile.mkdtemp(prefix="nlp-studio-trees-"))
        self.root.mkdir(parents=True, exist_ok=True)
        self.keep_seconds = keep_seconds or self.KEEP_SECONDS
        self.max_runs = max_runs or self.MAX_RUNS
        self.max_bytes = max_bytes or self.MAX_BYTES
        self._lock = threading.Lock()
        self._runs: dict[str, dict] = {}

    def keep(self, output_dir: Path, owner: str | None) -> dict | None:
        """Move a run's tree files out of its output folder.

        Returns {"run": id, "files": [{"name", "size"}], "skipped": [names]} -- or None when
        the run wrote no trees. A tree that would take the run past half the store is
        skipped rather than kept, and named in "skipped".
        """
        if not output_dir.is_dir():
            return None
        found = sorted(p for p in output_dir.iterdir() if p.is_file() and TREE_NAME.match(p.name))
        if not found:
            return None
        run_id = secrets.token_urlsafe(18)
        folder = self.root / run_id
        folder.mkdir()
        kept, skipped, total = [], [], 0
        # The final tree first, so a very large debug run still keeps it.
        for path in sorted(found, key=lambda p: (p.name != "final.tree", p.name)):
            size = path.stat().st_size
            if total + size > self.max_bytes // 2:
                skipped.append(path.name)
                continue
            shutil.move(str(path), folder / path.name)
            kept.append({"name": path.name, "size": size})
            total += size
        kept.sort(key=lambda f: f["name"])
        with self._lock:
            self._runs[run_id] = {"owner": owner, "created": time.time(), "bytes": total, "folder": folder}
            self._prune(keep=run_id)
        return {"run": run_id, "files": kept, "skipped": sorted(skipped)}

    def path(self, run_id: str, name: str, owner: str | None) -> Path | None:
        """The file of one kept tree, if it is still here and `owner` may read it."""
        if not TREE_NAME.match(name or ""):
            return None
        with self._lock:
            self._prune()
            entry = self._runs.get(run_id or "")
            if not entry or entry["owner"] != owner:
                return None
            path = entry["folder"] / name
        return path if path.is_file() else None

    def _prune(self, keep: str | None = None) -> None:
        now = time.time()
        for run_id, entry in list(self._runs.items()):
            if now - entry["created"] > self.keep_seconds and run_id != keep:
                self._drop(run_id)
        oldest_first = sorted(self._runs, key=lambda r: self._runs[r]["created"])
        while oldest_first and (len(self._runs) > self.max_runs
                                or sum(e["bytes"] for e in self._runs.values()) > self.max_bytes):
            run_id = oldest_first.pop(0)
            if run_id != keep:
                self._drop(run_id)

    def _drop(self, run_id: str) -> None:
        entry = self._runs.pop(run_id, None)
        if entry:
            shutil.rmtree(entry["folder"], ignore_errors=True)
