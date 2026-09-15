"""The studio's run server: runs analyzers for the page, one process per run.

    python server/app.py                  # the API on http://127.0.0.1:8765/api/
    python server/app.py --dist dist      # ...and the built site, from the same origin

    GET  /api/health  -> {"ok": true, "engine": "2.2.37", "timeout": 10, "maxRuns": 2}
    POST /api/run     {"files": {"spec/analyzer.seq": "...", ...}, "text": "..."}
                      -> 200 with nlp_run.run()'s result, whatever the run did;
                         400 for a request no analyzer could make, 413 too large,
                         503 when every run slot stays busy

Standard library only. The one dependency is NLPPlus, and only child.py imports it,
so this process never holds an engine. In development the page reaches it through
Vite's proxy (vite.config.ts).

No authentication. It listens on 127.0.0.1 unless told otherwise; read the run
server section of docs/ARCHITECTURE.md before letting anyone else reach it.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import nlp_run

MAX_BODY = 12 * nlp_run.MB


def engine_version(python: str) -> str | None:
    try:
        probe = subprocess.run([python, "-c", "import importlib.metadata as m; print(m.version('NLPPlus'))"],
                               capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return probe.stdout.strip() or None if probe.returncode == 0 else None


class RunServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, options: argparse.Namespace):
        super().__init__(address, Handler)
        self.options = options
        self.gate = threading.BoundedSemaphore(options.max_runs)
        self.engine = engine_version(options.python)


class Handler(SimpleHTTPRequestHandler):
    server: RunServer
    server_version = "nlp-studio-run"
    # Windows can map .js to text/plain from the registry, and a browser will not
    # run a module script served that way.
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
                      ".ttf": "font/ttf", ".svg": "image/svg+xml"}

    def __init__(self, request, client_address, server: RunServer):
        super().__init__(request, client_address, server, directory=server.options.dist or ".")

    def log_message(self, format, *args):
        if not self.server.options.quiet:
            super().log_message(format, *args)

    def _path(self) -> str:
        return self.path.split("?", 1)[0]

    def _json(self, code: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _site(self, serve) -> None:
        if not self.server.options.dist:
            self.send_error(404, "This server runs analyzers; the site is served from elsewhere.")
            return
        serve()

    def do_GET(self):
        path = self._path()
        if path == "/api/health":
            opts = self.server.options
            return self._json(200, {"ok": True, "engine": self.server.engine, "timeout": opts.timeout, "maxRuns": opts.max_runs})
        if path.startswith("/api/"):
            return self._json(404, {"status": "invalid", "message": "No such API."})
        self._site(super().do_GET)

    def do_HEAD(self):
        self._site(super().do_HEAD)

    def do_POST(self):
        if self._path() != "/api/run":
            return self._json(404, {"status": "invalid", "message": "No such API."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            return self._json(413, {"status": "invalid", "message": f"A run request may be at most {MAX_BODY // nlp_run.MB} MB."})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            files, text = body.get("files"), body.get("text")
        except (ValueError, AttributeError):
            return self._json(400, {"status": "invalid", "message": "The request is not JSON with files and text."})

        opts = self.server.options
        if not self.server.gate.acquire(timeout=opts.queue_wait):
            return self._json(503, {"status": "busy", "message": "Every run slot is taken. Try again in a moment."})
        try:
            result = nlp_run.run(files, text, python=opts.python, timeout=opts.timeout)
        except nlp_run.RunError as err:
            return self._json(400, {"status": "invalid", "message": str(err)})
        finally:
            self.server.gate.release()
        result["engine"] = self.server.engine
        self._json(200, result)


def options(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run NLP++ analyzers for NLP Studio.")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="port (default: 8765)")
    parser.add_argument("--dist", help="also serve this built site (studio/dist)")
    parser.add_argument("--timeout", type=float, default=nlp_run.DEFAULT_TIMEOUT, help="seconds a run may take")
    parser.add_argument("--max-runs", type=int, default=2, help="runs at the same time")
    parser.add_argument("--queue-wait", type=float, default=15.0, help="seconds a request waits for a free slot")
    parser.add_argument("--python", default=sys.executable, help="the Python with NLPPlus that runs analyzers")
    parser.add_argument("--quiet", action="store_true", help="do not log requests")
    return parser.parse_args(argv)


def main(argv=None) -> None:
    opts = options(argv)
    server = RunServer((opts.host, opts.port), opts)
    if not server.engine:
        print(f"warning: NLPPlus is not installed for {opts.python}; every run will fail.", file=sys.stderr)
    host, port = server.server_address[:2]
    site = f", serving {opts.dist}" if opts.dist else ""
    print(f"NLP Studio run server on http://{host}:{port} (NLPPlus {server.engine}, "
          f"{opts.timeout:g} s a run, {opts.max_runs} at a time{site})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
