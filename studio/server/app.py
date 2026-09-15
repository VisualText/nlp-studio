"""The studio's server: runs analyzers for the page, and signs people in with GitHub.

    python server/app.py                  # the API on http://127.0.0.1:8765/api/
    python server/app.py --dist dist      # ...and the built site, from the same origin

    GET  /api/health    {"ok": true, "engine": "2.2.38", "timeout": 10, "maxRuns": 2, "signIn": false, "github": false}
    POST /api/run       {"files": {"spec/analyzer.seq": "...", ...}, "text": "..."}
                        -> 200 with nlp_run.run()'s result, whatever the run did;
                           400 for a request no analyzer could make, 401 not signed in,
                           413 too large, 503 when every run slot stays busy

  GitHub (see SIGNING IN):

    GET  /api/auth/login        -> GitHub's sign-in page
    GET  /api/auth/callback     <- GitHub, with a code: an invited person gets a session cookie
    GET  /api/auth/me           {"signIn": true, "github": true, "signedIn": true, "login": "octocat"}
    POST /api/auth/logout
    GET  /api/github/repos                               repositories the person can reach
    GET  /api/github/analyzers?repo=owner/name[&ref=]    the analyzers in one, at a commit
    GET  /api/github/analyzer?repo=&commit=&folder=      one analyzer's files
    POST /api/github/commit     {"repo", "ref", "commit", "folder", "files": {path: text}, "message",
                                 "description"?, "branch"?} -> {"branch", "commit", "pullRequest": {"number", "url"}}
                                a new branch and pull request, or with "branch", more on that branch

SIGNING IN. Set NLP_STUDIO_GITHUB_CLIENT_ID and NLP_STUDIO_GITHUB_CLIENT_SECRET (a GitHub
App's), NLP_STUDIO_USERS (the invited GitHub logins, comma-separated) and
NLP_STUDIO_PUBLIC_URL (the address the page is served at, for GitHub's callback). Then
running analyzers and everything under /api/github/ need a signed-in, invited person.
Without them the server is as it was: no GitHub, and open to whoever reaches it.

NLP_STUDIO_GITHUB_TOKEN, a personal access token, instead gives the GitHub calls that
token with no sign-in at all -- for development on your own machine only, since anyone
who reaches the server acts as you. It is refused alongside sign-in.

Standard library only. The engine is the one dependency, and only child.py imports it.
In development the page reaches this through Vite's proxy (vite.config.ts).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.parse
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import nlp_run
from github import GitHub, GitHubError
from sessions import Session, Sessions

MAX_BODY = 12 * nlp_run.MB
COOKIE = "nlp_studio"


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
        def option(name: str, default: str = "") -> str:
            return getattr(options, name, None) or default

        github = GitHub(api=option("github_api", "https://api.github.com").rstrip("/"),
                        web=option("github_web", "https://github.com").rstrip("/"),
                        client_id=option("client_id"), client_secret=option("client_secret"))
        users = {u.strip().lower() for u in option("users").split(",") if u.strip()}
        public_url = option("public_url").rstrip("/")
        sign_in = bool(github.client_id and github.client_secret and users and public_url)
        dev_token = option("dev_token")
        if (github.client_id or github.client_secret or users) and not sign_in:
            raise ValueError("GitHub sign-in needs all of NLP_STUDIO_GITHUB_CLIENT_ID, NLP_STUDIO_GITHUB_CLIENT_SECRET, "
                             "NLP_STUDIO_USERS and NLP_STUDIO_PUBLIC_URL.")
        if sign_in and dev_token:
            raise ValueError("NLP_STUDIO_GITHUB_TOKEN is for development without sign-in; unset it when sign-in is on.")

        super().__init__(address, Handler)
        self.options = options
        self.gate = threading.BoundedSemaphore(options.max_runs)
        self.engine = engine_version(options.python)
        self.github = github
        self.users = users
        self.public_url = public_url
        self.sign_in = sign_in
        self.dev_token = dev_token
        self.dev_login: str | None = None
        self.sessions = Sessions()


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

    # ---- plumbing ---------------------------------------------------------------

    def _path(self) -> str:
        return self.path.split("?", 1)[0]

    def _query(self) -> dict[str, str]:
        return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).items()}

    def _json(self, code: int, body: dict, headers: dict | None = None) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def _page(self, code: int, text: str) -> None:
        data = f"{text}\n\nBack to NLP Studio: ../../\n".encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, location: str, headers: dict | None = None) -> None:
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()

    def _cookie(self, value: str, max_age: int) -> str:
        secure = "; Secure" if self.server.public_url.startswith("https://") else ""
        return f"{COOKIE}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"

    def _sid(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            jar = cookies.SimpleCookie(raw)
        except cookies.CookieError:
            return None
        return jar[COOKIE].value if COOKIE in jar and jar[COOKIE].value else None

    def _session(self) -> Session | None:
        """The person making this request, with a GitHub token fresh enough to use."""
        srv = self.server
        if srv.dev_token:
            return Session(login=srv.dev_login or "", token=srv.dev_token)
        sid = self._sid()
        session = srv.sessions.get(sid) if sid else None
        if session and session.token_expires and time.time() > session.token_expires - 60:
            try:
                if not session.refresh_token:
                    raise GitHubError(401, "expired")
                session.take(srv.github.refresh(session.refresh_token))
            except GitHubError:
                srv.sessions.drop(sid)
                return None
        return session

    def _site(self, serve) -> None:
        if not self.server.options.dist:
            self.send_error(404, "This server runs analyzers; the site is served from elsewhere.")
            return
        serve()

    # ---- routes -----------------------------------------------------------------

    def do_GET(self):
        path = self._path()
        srv = self.server
        if path == "/api/health":
            opts = srv.options
            return self._json(200, {"ok": True, "engine": srv.engine, "timeout": opts.timeout, "maxRuns": opts.max_runs,
                                    "signIn": srv.sign_in, "github": bool(srv.sign_in or srv.dev_token)})
        if path == "/api/auth/me":
            return self._me()
        if path == "/api/auth/login":
            return self._login()
        if path == "/api/auth/callback":
            return self._callback()
        if path.startswith("/api/github/"):
            return self._github(path)
        if path.startswith("/api/"):
            return self._json(404, {"status": "invalid", "message": "No such API."})
        self._site(super().do_GET)

    def do_HEAD(self):
        self._site(super().do_HEAD)

    def do_POST(self):
        path = self._path()
        srv = self.server
        if path == "/api/auth/logout":
            sid = self._sid()
            if sid:
                srv.sessions.drop(sid)
            return self._json(200, {"signedIn": False}, {"Set-Cookie": self._cookie("", 0)})
        if path == "/api/github/commit":
            return self._commit()
        if path != "/api/run":
            return self._json(404, {"status": "invalid", "message": "No such API."})
        if srv.sign_in and not self._session():
            return self._json(401, {"status": "unauthorized", "message": "Sign in with GitHub to run analyzers."})
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

        opts = srv.options
        if not srv.gate.acquire(timeout=opts.queue_wait):
            return self._json(503, {"status": "busy", "message": "Every run slot is taken. Try again in a moment."})
        try:
            result = nlp_run.run(files, text, python=opts.python, timeout=opts.timeout)
        except nlp_run.RunError as err:
            return self._json(400, {"status": "invalid", "message": str(err)})
        finally:
            srv.gate.release()
        result["engine"] = srv.engine
        self._json(200, result)

    def _commit(self) -> None:
        srv = self.server
        if not (srv.sign_in or srv.dev_token):
            return self._json(404, {"status": "invalid", "message": "GitHub is not set up on this server."})
        session = self._session()
        if not session:
            return self._json(401, {"status": "unauthorized", "message": "Sign in with GitHub first."})
        # JSON only: a form on another site cannot send it without asking first.
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self._json(415, {"status": "invalid", "message": "Send the commit as JSON."})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            return self._json(413, {"status": "invalid", "message": f"A commit may be at most {MAX_BODY // nlp_run.MB} MB."})
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self._json(400, {"status": "invalid", "message": "The request is not a JSON object."})
        try:
            login = session.login
            if srv.dev_token and not login:
                srv.dev_login = login = srv.dev_login or srv.github.user(srv.dev_token)
            result = srv.github.commit_analyzer(
                session.token, str(body.get("repo", "")), str(body.get("ref", "")), str(body.get("commit", "")),
                str(body.get("folder", "")), body.get("files"), str(body.get("message", "")),
                branch=str(body["branch"]) if body.get("branch") else None,
                description=str(body.get("description", "")), login=login)
        except GitHubError as err:
            return self._json(err.status, {"status": "github", "message": str(err)})
        self._json(200, result)

    def _me(self) -> None:
        srv = self.server
        login = None
        if srv.dev_token:
            if srv.dev_login is None:
                try:
                    srv.dev_login = srv.github.user(srv.dev_token)
                except GitHubError as err:
                    return self._json(err.status, {"status": "github", "message": str(err)})
            login = srv.dev_login
        else:
            session = self._session()
            login = session.login if session else None
        self._json(200, {"signIn": srv.sign_in, "github": bool(srv.sign_in or srv.dev_token),
                         "signedIn": bool(login), "login": login})

    def _login(self) -> None:
        srv = self.server
        if not srv.sign_in:
            return self._json(404, {"status": "invalid", "message": "Signing in is not set up on this server."})
        state = srv.sessions.new_state()
        self._redirect(srv.github.authorize_url(f"{srv.public_url}/api/auth/callback", state))

    def _callback(self) -> None:
        srv = self.server
        query = self._query()
        if not srv.sign_in:
            return self._json(404, {"status": "invalid", "message": "Signing in is not set up on this server."})
        if "error" in query:
            return self._page(403, f"GitHub did not sign you in: {query.get('error_description') or query['error']}.")
        if not query.get("state") or not srv.sessions.take_state(query["state"]):
            return self._page(400, "This sign-in has expired, or was not started here. Sign in again.")
        try:
            tokens = srv.github.exchange_code(query.get("code", ""), f"{srv.public_url}/api/auth/callback")
            login = srv.github.user(tokens["access_token"])
        except GitHubError as err:
            return self._page(502 if err.status >= 500 else 403, f"Signing in with GitHub failed: {err}")
        if login.lower() not in srv.users:
            return self._page(403, f"The GitHub account {login} is not invited to NLP Studio. "
                                   "Ask whoever runs it to add you.")
        sid = srv.sessions.create(Session.from_tokens(login, tokens))
        # Relative: the page may be served under a prefix (/studio/) this server never sees.
        self._redirect("../../", {"Set-Cookie": self._cookie(sid, Sessions.SESSION_SECONDS)})

    def _github(self, path: str) -> None:
        srv = self.server
        if not (srv.sign_in or srv.dev_token):
            return self._json(404, {"status": "invalid", "message": "GitHub is not set up on this server."})
        session = self._session()
        if not session:
            return self._json(401, {"status": "unauthorized", "message": "Sign in with GitHub first."})
        query = self._query()
        try:
            if path == "/api/github/repos":
                body = {"repositories": srv.github.repositories(session.token)}
            elif path == "/api/github/analyzers":
                body = srv.github.analyzers(session.token, query.get("repo", ""), query.get("ref") or None)
            elif path == "/api/github/analyzer":
                body = {"files": srv.github.read_analyzer(session.token, query.get("repo", ""),
                                                          query.get("commit", ""), query.get("folder", ""))}
            else:
                return self._json(404, {"status": "invalid", "message": "No such API."})
        except GitHubError as err:
            return self._json(err.status, {"status": "github", "message": str(err)})
        self._json(200, body)


def options(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run NLP++ analyzers for NLP Studio, and sign people in with GitHub.")
    parser.add_argument("--host", default="127.0.0.1", help="address to listen on (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="port (default: 8765)")
    parser.add_argument("--dist", help="also serve this built site (studio/dist)")
    parser.add_argument("--timeout", type=float, default=nlp_run.DEFAULT_TIMEOUT, help="seconds a run may take")
    parser.add_argument("--max-runs", type=int, default=2, help="runs at the same time")
    parser.add_argument("--queue-wait", type=float, default=15.0, help="seconds a request waits for a free slot")
    parser.add_argument("--python", default=sys.executable, help="the Python with NLPPlus that runs analyzers")
    parser.add_argument("--quiet", action="store_true", help="do not log requests")
    parser.add_argument("--public-url", default=os.environ.get("NLP_STUDIO_PUBLIC_URL", ""),
                        help="where the page is served, for GitHub's sign-in callback (NLP_STUDIO_PUBLIC_URL)")
    parser.add_argument("--github-api", default=os.environ.get("NLP_STUDIO_GITHUB_API", "https://api.github.com"),
                        help=argparse.SUPPRESS)
    parser.add_argument("--github-web", default=os.environ.get("NLP_STUDIO_GITHUB_WEB", "https://github.com"),
                        help=argparse.SUPPRESS)
    opts = parser.parse_args(argv)
    # Secrets come from the environment only, never the command line (visible in ps).
    opts.client_id = os.environ.get("NLP_STUDIO_GITHUB_CLIENT_ID", "")
    opts.client_secret = os.environ.get("NLP_STUDIO_GITHUB_CLIENT_SECRET", "")
    opts.users = os.environ.get("NLP_STUDIO_USERS", "")
    opts.dev_token = os.environ.get("NLP_STUDIO_GITHUB_TOKEN", "")
    return opts


def main(argv=None) -> None:
    opts = options(argv)
    try:
        server = RunServer((opts.host, opts.port), opts)
    except ValueError as err:
        print(f"nlp-studio: {err}", file=sys.stderr)
        sys.exit(2)
    if not server.engine:
        print(f"warning: NLPPlus is not installed for {opts.python}; every run will fail.", file=sys.stderr)
    host, port = server.server_address[:2]
    site = f", serving {opts.dist}" if opts.dist else ""
    github = (f"GitHub sign-in for {len(server.users)} invited" if server.sign_in
              else "GitHub through a development token, no sign-in" if server.dev_token else "no GitHub")
    print(f"NLP Studio run server on http://{host}:{port} (NLPPlus {server.engine}, "
          f"{opts.timeout:g} s a run, {opts.max_runs} at a time, {github}{site})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
