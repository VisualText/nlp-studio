"""A stand-in for github.com and api.github.com, for tests.

Just what the studio calls (see github.py): the sign-in token exchange, /user, the
repositories a token reaches, and reading repositories through commits, trees and
blobs. Repositories are given as {"owner/name": {path: text}}. Not part of the image.
"""
from __future__ import annotations

import base64
import hashlib
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _sha(*parts: str) -> str:
    return hashlib.sha1("\0".join(parts).encode("utf-8")).hexdigest()


class FakeGitHub:
    CLIENT_ID = "the-client-id"
    CLIENT_SECRET = "the-client-secret"
    CODE = "the-code"

    def __init__(self, repos: dict[str, dict[str, str]], login: str = "octocat", app: bool = True):
        self.repos = repos
        self.login = login
        prefix = "ghu_" if app else "ghp_"
        self.tokens = {f"{prefix}first"}
        self.refreshes = 0
        self.expires_in = 28800
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    @property
    def token(self) -> str:
        return sorted(self.tokens)[0]

    def start(self) -> "FakeGitHub":
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def commit_sha(self, repo: str) -> str:
        return _sha("commit", repo, json.dumps(self.repos[repo], sort_keys=True))

    def _handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _send(self, code: int, body) -> None:
                data = json.dumps(body).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                url = urllib.parse.urlsplit(self.path)
                if url.path != "/login/oauth/access_token":
                    return self._send(404, {"message": "Not Found"})
                form = {k: v[0] for k, v in urllib.parse.parse_qs(
                    self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()).items()}
                if form.get("client_id") != fake.CLIENT_ID or form.get("client_secret") != fake.CLIENT_SECRET:
                    return self._send(200, {"error": "incorrect_client_credentials"})
                if form.get("grant_type") == "refresh_token":
                    if form.get("refresh_token") != "ghr_refresh":
                        return self._send(200, {"error": "bad_refresh_token"})
                    fake.refreshes += 1
                    token = f"ghu_refreshed{fake.refreshes}"
                elif form.get("code") == fake.CODE:
                    token = fake.token
                else:
                    return self._send(200, {"error": "bad_verification_code",
                                            "error_description": "The code passed is incorrect or expired."})
                fake.tokens.add(token)
                self._send(200, {"access_token": token, "token_type": "bearer", "expires_in": fake.expires_in,
                                 "refresh_token": "ghr_refresh", "refresh_token_expires_in": 15897600})

            def do_GET(self):
                url = urllib.parse.urlsplit(self.path)
                query = urllib.parse.parse_qs(url.query)
                page = int(query.get("page", ["1"])[0])
                auth = self.headers.get("Authorization", "")
                if not auth.startswith("Bearer ") or auth[7:] not in fake.tokens:
                    return self._send(401, {"message": "Bad credentials"})
                parts = [urllib.parse.unquote(p) for p in url.path.strip("/").split("/")]
                repo_list = [{"full_name": name, "private": name.startswith("private/"), "default_branch": "main"}
                             for name in sorted(fake.repos)]

                if parts == ["user"]:
                    return self._send(200, {"login": fake.login})
                if parts == ["user", "installations"]:
                    return self._send(200, {"installations": [{"id": 7}] if page == 1 else []})
                if parts == ["user", "installations", "7", "repositories"]:
                    return self._send(200, {"repositories": repo_list if page == 1 else []})
                if parts == ["user", "repos"]:
                    return self._send(200, repo_list if page == 1 else [])
                if len(parts) >= 3 and parts[0] == "repos":
                    repo = f"{parts[1]}/{parts[2]}"
                    if repo not in fake.repos:
                        return self._send(404, {"message": "Not Found"})
                    files = fake.repos[repo]
                    rest = parts[3:]
                    if not rest:
                        return self._send(200, {"full_name": repo, "private": False, "default_branch": "main"})
                    if rest[0] == "commits" and len(rest) == 2:
                        if rest[1] not in ("main", fake.commit_sha(repo)):
                            return self._send(422, {"message": "No commit found for SHA"})
                        return self._send(200, {"sha": fake.commit_sha(repo),
                                                "commit": {"tree": {"sha": _sha("tree", fake.commit_sha(repo))}}})
                    if rest[:2] == ["git", "trees"]:
                        tree = [{"path": path, "type": "blob", "sha": _sha("blob", text),
                                 "size": len(text.encode("utf-8"))} for path, text in sorted(files.items())]
                        return self._send(200, {"sha": rest[2], "truncated": False, "tree": tree})
                    if rest[:2] == ["git", "blobs"]:
                        for text in files.values():
                            if _sha("blob", text) == rest[2]:
                                return self._send(200, {"sha": rest[2], "encoding": "base64",
                                                        "content": base64.b64encode(text.encode("utf-8")).decode()})
                        return self._send(404, {"message": "Not Found"})
                self._send(404, {"message": "Not Found"})

        return Handler
