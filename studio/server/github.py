"""GitHub for the studio: signing people in, and the analyzers in repositories they can reach.

The page never holds a GitHub token. GitHub will not exchange a sign-in code from a
browser -- github.com/login/oauth/access_token sends no CORS headers -- so the run
server does it, keeps the token in its session (sessions.py), and makes the few
calls the studio needs on the person's behalf:

    who they are                  GET /user
    repositories they can reach   GET /user/installations, /user/installations/{id}/repositories
                                      (a GitHub App's user token), or /user/repos (a personal token)
    a repository's analyzers      GET /repos/{repo}/commits/{ref}, /repos/{repo}/git/trees/{sha}?recursive=1
    one analyzer's files          GET /repos/{repo}/git/blobs/{sha}

An analyzer is any folder holding spec/analyzer.seq, at any depth. Only its spec/,
kb/ and input/ travel -- never output/, tmp/ or an engine run's *_log/ -- the same
rule as for the studio's own samples (scripts/copy-samples.mjs).

Standard library only, like the rest of the server.
"""
from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

TRAVELS = ("spec", "kb", "input")
MAX_FILES = 2000
MAX_BYTES = 8 * 1024 * 1024
MAX_FILE_BYTES = 1_000_000
API_VERSION = "2022-11-28"

_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_REF = re.compile(r"^[A-Za-z0-9._/-]{1,200}$")
_SHA = re.compile(r"^[0-9a-f]{40}$")


class GitHubError(Exception):
    """A GitHub call that failed, with the HTTP status the studio should answer."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _check_repo(repo: str) -> None:
    if not _REPO.match(repo or "") or ".." in repo:
        raise GitHubError(400, f"Not a repository name: {repo!r} (want owner/name).")


def analyzer_files(blobs: dict[str, dict], folder: str) -> list[tuple[str, dict]]:
    """The files of the analyzer at `folder` that travel: (path inside it, tree entry)."""
    prefix = f"{folder}/" if folder else ""
    found = []
    for path, entry in blobs.items():
        if not path.startswith(prefix):
            continue
        rel = path[len(prefix):]
        parts = rel.split("/")
        if len(parts) < 2 or parts[0] not in TRAVELS:
            continue
        if any(p.endswith("_log") or p in ("output", "tmp") for p in parts[1:-1]):
            continue
        if entry.get("size", 0) > MAX_FILE_BYTES:
            continue
        found.append((rel, entry))
    return sorted(found)


@dataclass
class GitHub:
    api: str = "https://api.github.com"
    web: str = "https://github.com"
    client_id: str = ""
    client_secret: str = ""
    timeout: float = 30.0

    # ---- signing in -------------------------------------------------------------

    def authorize_url(self, redirect_uri: str, state: str) -> str:
        query = urllib.parse.urlencode({"client_id": self.client_id, "redirect_uri": redirect_uri, "state": state})
        return f"{self.web}/login/oauth/authorize?{query}"

    def exchange_code(self, code: str, redirect_uri: str) -> dict:
        return self._token({"client_id": self.client_id, "client_secret": self.client_secret,
                            "code": code, "redirect_uri": redirect_uri})

    def refresh(self, refresh_token: str) -> dict:
        return self._token({"client_id": self.client_id, "client_secret": self.client_secret,
                            "grant_type": "refresh_token", "refresh_token": refresh_token})

    def _token(self, fields: dict) -> dict:
        data = self._request("POST", f"{self.web}/login/oauth/access_token",
                             body=urllib.parse.urlencode(fields).encode(),
                             headers={"Accept": "application/json",
                                      "Content-Type": "application/x-www-form-urlencoded"})
        if not isinstance(data, dict) or "access_token" not in data:
            reason = data.get("error_description") or data.get("error") if isinstance(data, dict) else None
            raise GitHubError(401, reason or "GitHub did not sign you in.")
        return data

    # ---- reading ----------------------------------------------------------------

    def user(self, token: str) -> str:
        return self._api(token, "/user")["login"]

    def repositories(self, token: str) -> list[dict]:
        if token.startswith("ghu_"):
            # A GitHub App's user token reaches what the app is installed on and the
            # person may see -- exactly the repositories the studio is meant to edit.
            raw = []
            for installation in self._pages(token, "/user/installations", "installations"):
                raw += self._pages(token, f"/user/installations/{installation['id']}/repositories", "repositories")
        else:
            raw = self._pages(token, "/user/repos?affiliation=owner,collaborator,organization_member", None)
        repos = {r["full_name"]: {"fullName": r["full_name"], "private": bool(r.get("private")),
                                  "defaultBranch": r.get("default_branch") or "main"} for r in raw}
        return sorted(repos.values(), key=lambda r: r["fullName"].lower())

    def analyzers(self, token: str, repo: str, ref: str | None = None) -> dict:
        _check_repo(repo)
        if ref is None:
            ref = self._api(token, f"/repos/{repo}").get("default_branch") or "main"
        commit, blobs = self._tree(token, repo, ref)
        found = []
        for path in blobs:
            if path == "spec/analyzer.seq" or path.endswith("/spec/analyzer.seq"):
                folder = path[: -len("spec/analyzer.seq")].rstrip("/")
                files = [rel for rel, _ in analyzer_files(blobs, folder)]
                title = folder.rsplit("/", 1)[-1] if folder else repo.split("/", 1)[1]
                found.append({"folder": folder, "title": title, "files": files})
        found.sort(key=lambda a: a["folder"].lower())
        return {"repo": repo, "ref": ref, "commit": commit, "analyzers": found}

    def read_analyzer(self, token: str, repo: str, commit: str, folder: str) -> dict[str, str]:
        _check_repo(repo)
        if not _SHA.match(commit or ""):
            raise GitHubError(400, "An analyzer is read at a commit: give its full sha.")
        folder = (folder or "").strip("/")
        if ".." in folder.split("/"):
            raise GitHubError(400, f"Not a folder: {folder!r}")
        _, blobs = self._tree(token, repo, commit)
        files = analyzer_files(blobs, folder)
        if not any(rel == "spec/analyzer.seq" for rel, _ in files):
            raise GitHubError(404, f"No analyzer at {folder or 'the top'} of {repo}.")
        if len(files) > MAX_FILES or sum(e.get("size", 0) for _, e in files) > MAX_BYTES:
            raise GitHubError(413, f"{folder or repo} is too large to open here.")
        with ThreadPoolExecutor(max_workers=8) as pool:
            texts = dict(pool.map(lambda item: (item[0], self._blob(token, repo, item[1]["sha"])), files))
        return dict(sorted(texts.items()))

    # ---- plumbing ---------------------------------------------------------------

    def _tree(self, token: str, repo: str, ref: str) -> tuple[str, dict[str, dict]]:
        if not (_SHA.match(ref) or (_REF.match(ref) and ".." not in ref)):
            raise GitHubError(400, f"Not a branch, tag or commit: {ref!r}")
        commit = self._api(token, f"/repos/{repo}/commits/{urllib.parse.quote(ref, safe='')}")
        tree = self._api(token, f"/repos/{repo}/git/trees/{commit['commit']['tree']['sha']}?recursive=1")
        if tree.get("truncated"):
            raise GitHubError(422, f"{repo} has too many files for GitHub to list in one go.")
        blobs = {e["path"]: e for e in tree.get("tree", []) if e.get("type") == "blob"}
        return commit["sha"], blobs

    def _blob(self, token: str, repo: str, sha: str) -> str:
        data = self._api(token, f"/repos/{repo}/git/blobs/{sha}")
        raw = base64.b64decode(data.get("content", "")) if data.get("encoding") == "base64" else data.get("content", "").encode()
        return raw.decode("utf-8", "replace")

    def _pages(self, token: str, path: str, key: str | None) -> list:
        items, page = [], 1
        joiner = "&" if "?" in path else "?"
        while True:
            data = self._api(token, f"{path}{joiner}per_page=100&page={page}")
            batch = data.get(key, []) if key else data
            items += batch
            if len(batch) < 100 or page >= 20:
                return items
            page += 1

    def _api(self, token: str, path: str):
        return self._request("GET", self.api + path, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION,
        })

    def _request(self, method: str, url: str, body: bytes | None = None, headers: dict | None = None):
        req = urllib.request.Request(url, data=body, method=method,
                                     headers={"User-Agent": "nlp-studio", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return json.loads(res.read() or b"null")
        except urllib.error.HTTPError as err:
            try:
                message = json.loads(err.read() or b"{}").get("message") or err.reason
            except ValueError:
                message = err.reason
            if err.code == 401:
                raise GitHubError(401, "GitHub no longer accepts this sign-in. Sign in again.") from None
            if err.code == 404:
                raise GitHubError(404, "Not found on GitHub, or not shared with NLP Studio.") from None
            raise GitHubError(err.code if err.code in (403, 409, 422) else 502, f"GitHub said: {message}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise GitHubError(502, "Could not reach GitHub.") from None
