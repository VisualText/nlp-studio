"""Signing in with GitHub, and opening analyzers from repositories -- against a stand-in GitHub.

    From studio/:   python -m unittest discover -s server

No engine and no network: fake_github.py plays GitHub.
"""
import http.client
import json
import sys
import threading
import time
import unittest
import urllib.parse
from argparse import Namespace
from datetime import datetime, timezone

import app
from fake_github import FakeGitHub
from github import GitHub, GitHubError, analyzer_files

SEQ = "tokenize\tnil\nnlp\trules\n"
REPOS = {
    "acme/analyzers": {
        "README.md": "# not an analyzer\n",
        "hello/spec/analyzer.seq": SEQ,
        "hello/spec/rules.nlp": "@CODE\n@@CODE\n",
        "hello/kb/user/hier.kb": "add root\n",
        "hello/input/text.txt": "héllo 😀\n",
        "hello/input/text.txt_log/final.tree": "an engine run's log -- stays behind\n",
        "hello/output/output.json": "{}",
        "hello/notes.md": "not in spec, kb or input\n",
        "deep/down/tagger/spec/analyzer.seq": SEQ,
        "deep/down/tagger/spec/rules.nlp": "@CODE\n@@CODE\n",
    },
    "acme/other": {"spec/analyzer.seq": SEQ, "spec/rules.nlp": "", "input/a.txt": "a\n"},
}


class Client:
    """HTTP without following redirects, holding the session cookie like a browser."""

    def __init__(self, port: int):
        self.port = port
        self.cookie = None

    def call(self, method: str, path: str, body: bytes | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        headers = {"Content-Type": "application/json"}
        if self.cookie:
            headers["Cookie"] = self.cookie
        conn.request(method, path, body=body, headers=headers)
        res = conn.getresponse()
        data = res.read()
        set_cookie = res.getheader("Set-Cookie")
        if set_cookie:
            value = set_cookie.split(";", 1)[0]
            self.cookie = None if value.endswith("=") else value
        conn.close()
        return res.status, res, data

    def json(self, method: str, path: str, body: dict | None = None):
        status, _, data = self.call(method, path, json.dumps(body).encode() if body is not None else None)
        return status, json.loads(data or b"null")


def start(options: dict):
    opts = Namespace(host="127.0.0.1", port=0, dist=None, timeout=10.0, max_runs=1, queue_wait=5.0,
                     python=sys.executable, quiet=True, **options)
    server = app.RunServer(("127.0.0.1", 0), opts)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class SignIn(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeGitHub(REPOS, login="OctoCat").start()
        cls.server = start({"client_id": FakeGitHub.CLIENT_ID, "client_secret": FakeGitHub.CLIENT_SECRET,
                            "users": "someone, octocat", "public_url": "http://studio.test/studio",
                            "github_api": cls.fake.url, "github_web": cls.fake.url})
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.fake.stop()

    def setUp(self):
        self.fake.login = "OctoCat"

    def sign_in(self) -> Client:
        client = Client(self.port)
        status, res, _ = client.call("GET", "/api/auth/login")
        self.assertEqual(status, 302)
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(res.getheader("Location")).query)["state"][0]
        status, res, body = client.call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state={state}")
        self.assertEqual(status, 302, body)
        return client

    def test_health_says_sign_in_is_on(self):
        status, body = Client(self.port).json("GET", "/api/health")
        self.assertEqual((status, body["signIn"], body["github"]), (200, True, True))

    def test_login_goes_to_github_with_the_callback_and_a_state(self):
        status, res, _ = Client(self.port).call("GET", "/api/auth/login")
        location = urllib.parse.urlsplit(res.getheader("Location"))
        query = urllib.parse.parse_qs(location.query)
        self.assertEqual(status, 302)
        self.assertEqual(f"{location.scheme}://{location.netloc}{location.path}", f"{self.fake.url}/login/oauth/authorize")
        self.assertEqual(query["client_id"], [FakeGitHub.CLIENT_ID])
        self.assertEqual(query["redirect_uri"], ["http://studio.test/studio/api/auth/callback"])
        self.assertGreater(len(query["state"][0]), 20)

    def test_an_invited_person_is_signed_in_with_a_cookie_the_page_cannot_read(self):
        client = Client(self.port)
        _, res, _ = client.call("GET", "/api/auth/login")
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(res.getheader("Location")).query)["state"][0]
        status, res, _ = client.call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state={state}")
        self.assertEqual((status, res.getheader("Location")), (302, "../../"))
        cookie = res.getheader("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)
        self.assertNotIn("Secure", cookie)  # the public URL here is http
        status, me = client.json("GET", "/api/auth/me")
        self.assertEqual((status, me["signedIn"], me["login"]), (200, True, "OctoCat"))

    def test_a_state_is_good_once(self):
        client = Client(self.port)
        _, res, _ = client.call("GET", "/api/auth/login")
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(res.getheader("Location")).query)["state"][0]
        client.call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state={state}")
        status, _, _ = Client(self.port).call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state={state}")
        self.assertEqual(status, 400)
        status, _, _ = Client(self.port).call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state=made-up")
        self.assertEqual(status, 400)

    def test_someone_not_invited_is_turned_away_without_a_session(self):
        self.fake.login = "mallory"
        client = Client(self.port)
        _, res, _ = client.call("GET", "/api/auth/login")
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(res.getheader("Location")).query)["state"][0]
        status, res, body = client.call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state={state}")
        self.assertEqual(status, 403)
        self.assertIn(b"mallory is not invited", body)
        self.assertIsNone(res.getheader("Set-Cookie"))

    def test_a_bad_code_signs_no_one_in(self):
        client = Client(self.port)
        _, res, _ = client.call("GET", "/api/auth/login")
        state = urllib.parse.parse_qs(urllib.parse.urlsplit(res.getheader("Location")).query)["state"][0]
        status, res, body = client.call("GET", f"/api/auth/callback?code=wrong&state={state}")
        self.assertEqual(status, 403)
        self.assertIsNone(res.getheader("Set-Cookie"))

    def test_running_needs_a_signed_in_person(self):
        status, body = Client(self.port).json("POST", "/api/run", {"files": {}, "text": ""})
        self.assertEqual((status, body["status"]), (401, "unauthorized"))
        # Signed in, the same request gets past the gate (and is refused as a bad request).
        status, body = self.sign_in().json("POST", "/api/run", {"files": {}, "text": ""})
        self.assertEqual((status, body["status"]), (400, "invalid"))

    def test_github_calls_need_a_signed_in_person(self):
        for path in ["/api/github/repos", "/api/github/analyzers?repo=acme/analyzers"]:
            with self.subTest(path=path):
                status, body = Client(self.port).json("GET", path)
                self.assertEqual((status, body["status"]), (401, "unauthorized"))

    def test_the_repositories_the_app_reaches(self):
        status, body = self.sign_in().json("GET", "/api/github/repos")
        self.assertEqual(status, 200)
        self.assertEqual([r["fullName"] for r in body["repositories"]], ["acme/analyzers", "acme/other"])

    def test_analyzers_are_found_wherever_they_are_and_only_their_files_travel(self):
        status, body = self.sign_in().json("GET", "/api/github/analyzers?repo=acme/analyzers")
        self.assertEqual(status, 200, body)
        self.assertEqual((body["ref"], body["commit"]), ("main", self.fake.commit_sha("acme/analyzers")))
        self.assertEqual([(a["folder"], a["title"]) for a in body["analyzers"]],
                         [("deep/down/tagger", "tagger"), ("hello", "hello")])
        hello = next(a for a in body["analyzers"] if a["folder"] == "hello")
        self.assertEqual(hello["files"], ["input/text.txt", "kb/user/hier.kb", "spec/analyzer.seq", "spec/rules.nlp"])

    def test_an_analyzer_at_the_top_of_a_repository_is_named_after_it(self):
        status, body = self.sign_in().json("GET", "/api/github/analyzers?repo=acme/other")
        self.assertEqual([(a["folder"], a["title"]) for a in body["analyzers"]], [("", "other")])

    def test_an_analyzer_is_read_at_its_commit(self):
        client = self.sign_in()
        commit = self.fake.commit_sha("acme/analyzers")
        status, body = client.json("GET", f"/api/github/analyzer?repo=acme/analyzers&commit={commit}&folder=hello")
        self.assertEqual(status, 200, body)
        self.assertEqual(body["files"], {path[len("hello/"):]: text for path, text in REPOS["acme/analyzers"].items()
                                         if path.startswith("hello/") and path.split("/")[1] in ("spec", "kb", "input")
                                         and "_log/" not in path})

    def test_bad_names_are_refused_before_github_is_asked(self):
        client = self.sign_in()
        commit = self.fake.commit_sha("acme/analyzers")
        for path in ["/api/github/analyzers?repo=../etc", "/api/github/analyzers?repo=acme",
                     "/api/github/analyzer?repo=acme/analyzers&commit=main&folder=hello",
                     f"/api/github/analyzer?repo=acme/analyzers&commit={commit}&folder=../hello"]:
            with self.subTest(path=path):
                status, body = client.json("GET", path)
                self.assertEqual((status, body["status"]), (400, "github"))

    def test_what_github_does_not_have_is_404(self):
        client = self.sign_in()
        status, _ = client.json("GET", "/api/github/analyzers?repo=acme/missing")
        self.assertEqual(status, 404)
        commit = self.fake.commit_sha("acme/analyzers")
        status, body = client.json("GET", f"/api/github/analyzer?repo=acme/analyzers&commit={commit}&folder=README.md")
        self.assertEqual(status, 404, body)

    def test_an_expired_token_is_refreshed_quietly(self):
        client = self.sign_in()
        sid = client.cookie.split("=", 1)[1]
        self.server.sessions.get(sid).token_expires = time.time() - 5
        before = self.fake.refreshes
        status, body = client.json("GET", "/api/github/repos")
        self.assertEqual(status, 200, body)
        self.assertEqual(self.fake.refreshes, before + 1)

    def test_signing_out(self):
        client = self.sign_in()
        status, _ = client.json("POST", "/api/auth/logout")
        self.assertEqual(status, 200)
        self.assertIsNone(client.cookie)
        status, me = client.json("GET", "/api/auth/me")
        self.assertEqual((status, me["signedIn"]), (200, False))


def signed_in(port: int) -> Client:
    client = Client(port)
    _, res, _ = client.call("GET", "/api/auth/login")
    state = urllib.parse.parse_qs(urllib.parse.urlsplit(res.getheader("Location")).query)["state"][0]
    status, _, body = client.call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state={state}")
    assert status == 302, body
    return client


class Committing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeGitHub(REPOS, login="OctoCat", read_only=("acme/other",)).start()
        cls.server = start({"client_id": FakeGitHub.CLIENT_ID, "client_secret": FakeGitHub.CLIENT_SECRET,
                            "users": "octocat", "public_url": "http://studio.test/studio",
                            "github_api": cls.fake.url, "github_web": cls.fake.url})
        cls.port = cls.server.server_address[1]
        cls.minute = 0

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.fake.stop()

    def setUp(self):
        # Each test commits at its own minute, so branch names never collide by accident.
        Committing.minute += 1
        stamp = datetime(2026, 9, 15, 10, Committing.minute, tzinfo=timezone.utc)
        self.server.github.now = lambda: stamp
        self.client = signed_in(self.port)

    def commit(self, **changes):
        body = {"repo": "acme/analyzers", "ref": "main", "commit": self.fake.commit_sha("acme/analyzers"),
                "folder": "hello", "files": {"spec/rules.nlp": "@CODE\n# changed in the studio\n@@CODE\n"},
                "message": "Change the rules\n\nMore about it.", "description": "Why it changed."}
        body.update(changes)
        return self.client.json("POST", "/api/github/commit", body)

    def test_a_commit_goes_on_a_new_branch_with_a_pull_request(self):
        status, body = self.commit()
        self.assertEqual(status, 200, body)
        self.assertEqual(body["branch"], f"nlp-studio/octocat/hello-20260915-10{Committing.minute:02d}")
        pull = self.fake.pulls["acme/analyzers"][body["pullRequest"]["number"] - 1]
        self.assertEqual((pull["head"]["ref"], pull["base"]["ref"], pull["title"], pull["body"]),
                         (body["branch"], "main", "Change the rules", "Why it changed."))
        self.assertEqual(body["pullRequest"]["url"], pull["html_url"])

        on_branch = self.fake.files_at("acme/analyzers", body["branch"])
        self.assertEqual(on_branch["hello/spec/rules.nlp"], "@CODE\n# changed in the studio\n@@CODE\n")
        self.assertEqual({k: v for k, v in on_branch.items() if k != "hello/spec/rules.nlp"},
                         {k: v for k, v in REPOS["acme/analyzers"].items() if k != "hello/spec/rules.nlp"})
        self.assertEqual(self.fake.files_at("acme/analyzers", "main"), REPOS["acme/analyzers"])
        self.assertEqual(self.fake.commits[body["commit"]]["parents"], [self.fake.commit_sha("acme/analyzers")])

    def test_committing_again_adds_to_the_same_branch_and_pull_request(self):
        _, first = self.commit()
        status, second = self.commit(ref=first["branch"], commit=first["commit"], branch=first["branch"],
                                     files={"input/text.txt": "a second input\n"}, message="Change the input")
        self.assertEqual(status, 200, second)
        self.assertEqual((second["branch"], second["pullRequest"]), (first["branch"], first["pullRequest"]))
        on_branch = self.fake.files_at("acme/analyzers", first["branch"])
        self.assertEqual((on_branch["hello/spec/rules.nlp"], on_branch["hello/input/text.txt"]),
                         ("@CODE\n# changed in the studio\n@@CODE\n", "a second input\n"))
        self.assertEqual(self.fake.commits[second["commit"]]["parents"], [first["commit"]])

    def test_a_branch_that_moved_on_is_not_overwritten(self):
        _, first = self.commit()
        # Opened before the first commit landed: its base is no longer the branch's tip.
        status, body = self.commit(ref=first["branch"], branch=first["branch"], files={"input/text.txt": "late\n"})
        self.assertEqual(status, 409, body)
        self.assertIn("has moved on", body["message"])
        self.assertEqual(self.fake.commit_sha("acme/analyzers", first["branch"]), first["commit"])

    def test_a_branch_name_already_taken_gets_a_number(self):
        taken = f"nlp-studio/octocat/hello-20260915-10{Committing.minute:02d}"
        self.fake.refs[("acme/analyzers", taken)] = self.fake.commit_sha("acme/analyzers")
        status, body = self.commit()
        self.assertEqual((status, body["branch"]), (200, f"{taken}-2"))

    def test_a_repository_you_cannot_write_to_says_so(self):
        status, body = self.commit(repo="acme/other", commit=self.fake.commit_sha("acme/other"), folder="")
        self.assertEqual(status, 403, body)
        self.assertIn("cannot write to acme/other", body["message"])

    def test_only_an_analyzers_own_files_can_be_committed(self):
        for files in [{"../README.md": "x"}, {"output/output.json": "{}"}, {"spec/../../x": "x"}, {"notes.md": "x"}, {}]:
            with self.subTest(files=files):
                status, body = self.commit(files=files)
                self.assertEqual((status, body["status"]), (400, "github"), body)

    def test_a_commit_needs_a_message_and_a_real_base(self):
        for changes in [{"message": "  "}, {"commit": "main"}, {"ref": "../main"}, {"folder": "../hello"}]:
            with self.subTest(changes=changes):
                self.assertEqual(self.commit(**changes)[0], 400)

    def test_committing_needs_a_signed_in_person_and_json(self):
        status, _ = Client(self.port).json("POST", "/api/github/commit", {"repo": "acme/analyzers"})
        self.assertEqual(status, 401)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        conn.request("POST", "/api/github/commit", body="repo=acme/analyzers",
                     headers={"Cookie": self.client.cookie, "Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(conn.getresponse().status, 415)
        conn.close()


class DevelopmentToken(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeGitHub(REPOS, login="dev", app=False).start()
        cls.server = start({"dev_token": cls.fake.token, "github_api": cls.fake.url, "github_web": cls.fake.url})
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.fake.stop()

    def test_github_works_without_signing_in(self):
        client = Client(self.port)
        status, me = client.json("GET", "/api/auth/me")
        self.assertEqual((status, me["signIn"], me["github"], me["signedIn"], me["login"]), (200, False, True, True, "dev"))
        status, body = client.json("GET", "/api/github/repos")
        self.assertEqual([r["fullName"] for r in body["repositories"]], ["acme/analyzers", "acme/other"])

    def test_running_stays_open(self):
        status, body = Client(self.port).json("POST", "/api/run", {"files": {}, "text": ""})
        self.assertEqual((status, body["status"]), (400, "invalid"))


class Configuration(unittest.TestCase):
    def test_half_configured_sign_in_is_refused(self):
        with self.assertRaisesRegex(ValueError, "needs all of"):
            start({"client_id": "id", "client_secret": "", "users": "a", "public_url": "http://x"})

    def test_requiring_sign_in_refuses_to_start_without_it(self):
        for options in [{}, {"dev_token": "ghp_x"}, {"client_id": "id", "client_secret": "s", "users": "a"}]:
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, "REQUIRE_SIGN_IN"):
                start({**options, "require_sign_in": "1"})

    def test_requiring_sign_in_starts_when_it_is_configured(self):
        server = start({"client_id": "id", "client_secret": "s", "users": "a",
                        "public_url": "https://studio.visualtext.org/studio", "require_sign_in": "true"})
        try:
            self.assertTrue(server.sign_in)
        finally:
            server.shutdown()
            server.server_close()

    def test_a_development_token_is_refused_alongside_sign_in(self):
        with self.assertRaisesRegex(ValueError, "development"):
            start({"client_id": "id", "client_secret": "s", "users": "a", "public_url": "http://x", "dev_token": "ghp_x"})

    def test_without_github_the_server_is_as_it_was(self):
        server = start({})
        try:
            client = Client(server.server_address[1])
            self.assertEqual(client.json("GET", "/api/auth/me")[1], {"signIn": False, "github": False, "signedIn": False, "login": None})
            self.assertEqual(client.json("GET", "/api/github/repos")[0], 404)
            self.assertEqual(client.json("GET", "/api/auth/login")[0], 404)
        finally:
            server.shutdown()
            server.server_close()

    def test_a_secure_cookie_when_the_page_is_https(self):
        fake = FakeGitHub(REPOS).start()
        server = start({"client_id": FakeGitHub.CLIENT_ID, "client_secret": FakeGitHub.CLIENT_SECRET, "users": "octocat",
                        "public_url": "https://studio.visualtext.org/studio", "github_api": fake.url, "github_web": fake.url})
        try:
            client = Client(server.server_address[1])
            _, res, _ = client.call("GET", "/api/auth/login")
            state = urllib.parse.parse_qs(urllib.parse.urlsplit(res.getheader("Location")).query)["state"][0]
            _, res, _ = client.call("GET", f"/api/auth/callback?code={FakeGitHub.CODE}&state={state}")
            self.assertIn("; Secure", res.getheader("Set-Cookie"))
        finally:
            server.shutdown()
            server.server_close()
            fake.stop()


class Files(unittest.TestCase):
    def test_only_spec_kb_and_input_travel(self):
        blobs = {p: {"sha": "x", "size": 10} for p in [
            "a/spec/analyzer.seq", "a/kb/user/x.kb", "a/input/t.txt", "a/input/t.txt_log/final.tree",
            "a/output/o.json", "a/spec/tmp/x", "a/README.md", "a/b/spec/analyzer.seq", "ab/spec/analyzer.seq"]}
        self.assertEqual([rel for rel, _ in analyzer_files(blobs, "a")], ["input/t.txt", "kb/user/x.kb", "spec/analyzer.seq"])

    def test_a_file_too_large_to_edit_stays_behind(self):
        blobs = {"spec/analyzer.seq": {"sha": "x", "size": 10}, "kb/big.dict": {"sha": "y", "size": 5_000_000}}
        self.assertEqual([rel for rel, _ in analyzer_files(blobs, "")], ["spec/analyzer.seq"])

    def test_unreachable_github_is_a_502(self):
        with self.assertRaises(GitHubError) as caught:
            GitHub(api="http://127.0.0.1:9", timeout=2).user("ghu_x")
        self.assertEqual(caught.exception.status, 502)


if __name__ == "__main__":
    unittest.main()
