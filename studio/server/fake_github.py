"""A stand-in for github.com and api.github.com, for tests.

Just what the studio calls (see github.py): the sign-in token exchange, /user, the
repositories a token reaches, reading through commits, trees and blobs, and writing
through trees, commits, branch refs and pull requests. Repositories are given as
{"owner/name": {path: text}}, each on a "main" branch. Not part of the image.
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

    def __init__(self, repos: dict[str, dict[str, str]], login: str = "octocat", app: bool = True,
                 read_only: tuple[str, ...] = ()):
        self.login = login
        self.read_only = set(read_only)
        prefix = "ghu_" if app else "ghp_"
        self.tokens = {f"{prefix}first"}
        self.refreshes = 0
        self.expires_in = 28800
        self.lock = threading.Lock()
        self.repo_names = sorted(repos)
        self.trees: dict[str, dict[str, str]] = {}
        self.commits: dict[str, dict] = {}
        self.refs: dict[tuple[str, str], str] = {}
        self.pulls: dict[str, list[dict]] = {}
        for name, files in repos.items():
            self.refs[(name, "main")] = self._commit(self._tree(files), [], f"The first commit of {name}")
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

    def commit_sha(self, repo: str, branch: str = "main") -> str:
        return self.refs[(repo, branch)]

    def files_at(self, repo: str, branch: str = "main") -> dict[str, str]:
        return self.trees[self.commits[self.refs[(repo, branch)]]["tree"]]

    def _tree(self, files: dict[str, str]) -> str:
        sha = _sha("tree", json.dumps(files, sort_keys=True))
        self.trees[sha] = dict(files)
        return sha

    def _commit(self, tree: str, parents: list[str], message: str) -> str:
        sha = _sha("commit", tree, *parents, message)
        self.commits[sha] = {"tree": tree, "parents": list(parents), "message": message}
        return sha

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

            def _body(self) -> bytes:
                return self.rfile.read(int(self.headers.get("Content-Length") or 0))

            def _authorized(self) -> bool:
                auth = self.headers.get("Authorization", "")
                if auth.startswith("Bearer ") and auth[7:] in fake.tokens:
                    return True
                self._send(401, {"message": "Bad credentials"})
                return False

            def _repo(self, parts: list[str]) -> str | None:
                if len(parts) >= 3 and parts[0] == "repos" and f"{parts[1]}/{parts[2]}" in fake.repo_names:
                    return f"{parts[1]}/{parts[2]}"
                self._send(404, {"message": "Not Found"})
                return None

            def _parts(self) -> tuple[list[str], dict]:
                url = urllib.parse.urlsplit(self.path)
                return ([urllib.parse.unquote(p) for p in url.path.strip("/").split("/")],
                        {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()})

            # ---- sign-in -------------------------------------------------------------

            def _token_exchange(self) -> None:
                form = {k: v[0] for k, v in urllib.parse.parse_qs(self._body().decode()).items()}
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

            # ---- reading -------------------------------------------------------------

            def do_GET(self):
                if not self._authorized():
                    return
                parts, query = self._parts()
                page = int(query.get("page", "1"))
                repo_list = [{"full_name": name, "private": name.startswith("private/"), "default_branch": "main"}
                             for name in fake.repo_names]
                if parts == ["user"]:
                    return self._send(200, {"login": fake.login})
                if parts == ["user", "installations"]:
                    return self._send(200, {"installations": [{"id": 7}] if page == 1 else []})
                if parts == ["user", "installations", "7", "repositories"]:
                    return self._send(200, {"repositories": repo_list if page == 1 else []})
                if parts == ["user", "repos"]:
                    return self._send(200, repo_list if page == 1 else [])
                repo = self._repo(parts)
                if not repo:
                    return
                rest = parts[3:]
                with fake.lock:
                    if not rest:
                        return self._send(200, {"full_name": repo, "private": False, "default_branch": "main"})
                    if rest[0] == "commits" and len(rest) == 2:
                        sha = fake.refs.get((repo, rest[1])) or (rest[1] if rest[1] in fake.commits else None)
                        if not sha:
                            return self._send(422, {"message": f"No commit found for SHA: {rest[1]}"})
                        return self._send(200, {"sha": sha, "commit": {"tree": {"sha": fake.commits[sha]["tree"]}}})
                    if rest[:2] == ["git", "commits"] and len(rest) == 3 and rest[2] in fake.commits:
                        commit = fake.commits[rest[2]]
                        return self._send(200, {"sha": rest[2], "tree": {"sha": commit["tree"]},
                                                "parents": [{"sha": p} for p in commit["parents"]]})
                    if rest[:2] == ["git", "trees"] and len(rest) == 3 and rest[2] in fake.trees:
                        tree = [{"path": path, "type": "blob", "sha": _sha("blob", text), "size": len(text.encode("utf-8"))}
                                for path, text in sorted(fake.trees[rest[2]].items())]
                        return self._send(200, {"sha": rest[2], "truncated": False, "tree": tree})
                    if rest[:2] == ["git", "blobs"] and len(rest) == 3:
                        for files in fake.trees.values():
                            for text in files.values():
                                if _sha("blob", text) == rest[2]:
                                    return self._send(200, {"sha": rest[2], "encoding": "base64",
                                                            "content": base64.b64encode(text.encode("utf-8")).decode()})
                    if rest == ["pulls"]:
                        head = query.get("head", "")
                        state = query.get("state", "open")
                        return self._send(200, [p for p in fake.pulls.get(repo, [])
                                                if (not head or f"{repo.split('/')[0]}:{p['head']['ref']}" == head)
                                                and (state == "all" or p["state"] == state)])
                self._send(404, {"message": "Not Found"})

            # ---- writing -------------------------------------------------------------

            def do_POST(self):
                parts, _ = self._parts()
                if parts == ["login", "oauth", "access_token"]:
                    return self._token_exchange()
                if not self._authorized():
                    return
                repo = self._repo(parts)
                if not repo:
                    return
                if repo in fake.read_only:
                    # What GitHub answers a write it will not allow: the resource "does not exist".
                    return self._send(404, {"message": "Not Found"})
                body = json.loads(self._body() or b"{}")
                rest = parts[3:]
                with fake.lock:
                    if rest == ["git", "trees"]:
                        files = dict(fake.trees.get(body.get("base_tree"), {}))
                        for entry in body.get("tree", []):
                            if "sha" in entry and entry["sha"] is None:
                                files.pop(entry["path"], None)
                            else:
                                files[entry["path"]] = entry["content"]
                        return self._send(201, {"sha": fake._tree(files)})
                    if rest == ["git", "commits"]:
                        if body.get("tree") not in fake.trees or any(p not in fake.commits for p in body.get("parents", [])):
                            return self._send(422, {"message": "Tree or parent SHA does not exist"})
                        sha = fake._commit(body["tree"], body.get("parents", []), body.get("message", ""))
                        return self._send(201, {"sha": sha, "html_url": f"{fake.url}/{repo}/commit/{sha}"})
                    if rest == ["git", "refs"]:
                        branch = body.get("ref", "").removeprefix("refs/heads/")
                        if (repo, branch) in fake.refs:
                            return self._send(422, {"message": "Reference already exists"})
                        if body.get("sha") not in fake.commits:
                            return self._send(422, {"message": "Object does not exist"})
                        fake.refs[(repo, branch)] = body["sha"]
                        return self._send(201, {"ref": f"refs/heads/{branch}", "object": {"sha": body["sha"]}})
                    if rest == ["pulls"]:
                        if (repo, body.get("head")) not in fake.refs or (repo, body.get("base")) not in fake.refs:
                            return self._send(422, {"message": "Validation Failed"})
                        pulls = fake.pulls.setdefault(repo, [])
                        number = len(pulls) + 1
                        pull = {"number": number, "state": "open", "title": body.get("title"), "body": body.get("body"),
                                "head": {"ref": body["head"]}, "base": {"ref": body["base"]},
                                "html_url": f"{fake.url}/{repo}/pull/{number}"}
                        pulls.append(pull)
                        return self._send(201, pull)
                self._send(404, {"message": "Not Found"})

            def do_PATCH(self):
                if not self._authorized():
                    return
                parts, _ = self._parts()
                repo = self._repo(parts)
                if not repo:
                    return
                if repo in fake.read_only:
                    return self._send(404, {"message": "Not Found"})
                rest = parts[3:]
                if rest[:3] != ["git", "refs", "heads"] or len(rest) < 4:
                    return self._send(404, {"message": "Not Found"})
                branch = "/".join(rest[3:])
                body = json.loads(self._body() or b"{}")
                with fake.lock:
                    current = fake.refs.get((repo, branch))
                    if current is None:
                        return self._send(422, {"message": "Reference does not exist"})
                    if body.get("sha") not in fake.commits:
                        return self._send(422, {"message": "Object does not exist"})
                    if not body.get("force") and current not in fake.commits[body["sha"]]["parents"]:
                        return self._send(422, {"message": "Update is not a fast forward"})
                    fake.refs[(repo, branch)] = body["sha"]
                return self._send(200, {"ref": f"refs/heads/{branch}", "object": {"sha": body["sha"]}})

        return Handler
