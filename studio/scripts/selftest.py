"""Open a build of the studio in a headless browser and wait for its own checks.

    npm run build && npm run selftest          (or: python scripts/selftest.py dist)

Serves the folder, opens index.html?selftest in headless Edge or Chrome, and waits
for the page to POST what src/selftest.ts found. Exits 0 only when every check
passed. BROWSER=<path> picks the browser; otherwise the usual install paths are
tried.

The page is served over http, not opened from disk: a Web Worker cannot start from
a file:// page, and the language server is one.
"""
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

CANDIDATES = [
    os.environ.get("BROWSER", ""),
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    "/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def main() -> int:
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "dist")
    if not os.path.isfile(os.path.join(root, "index.html")):
        print(f"selftest: no index.html in {root} -- run npm run build first")
        return 2
    browser = next((c for c in CANDIDATES if c and os.path.exists(c)), None)
    if not browser:
        print("selftest: no Edge or Chrome found; set BROWSER")
        return 2

    result: dict = {}

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=root, **k)

        def log_message(self, *a):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            result["data"] = json.loads(body or b"{}")
            self.send_response(204)
            self.end_headers()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html?selftest"
    profile = tempfile.mkdtemp(prefix="nlp-studio-selftest-")
    proc = subprocess.Popen(
        [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
         f"--user-data-dir={profile}", "--window-size=1280,900", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    start = time.time()
    try:
        while "data" not in result and time.time() - start < 90:
            time.sleep(0.25)
    finally:
        if os.name == "nt":
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
        else:
            proc.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    data = result.get("data")
    if not data:
        print(f"selftest: no result from the page after {time.time() - start:.0f}s")
        return 1
    for c in data["checks"]:
        print(f"{'ok ' if c['ok'] else 'BAD'} | {c['name']:<70} | {json.dumps(c['got'])[:120]}")
    passed = sum(1 for c in data["checks"] if c["ok"])
    print(f"\nselftest: {passed}/{len(data['checks'])} passed in {time.time() - start:.1f}s")
    return 0 if data["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
