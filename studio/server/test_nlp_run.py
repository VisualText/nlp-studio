"""Tests for the run server.  From studio/:   python -m unittest discover -s server

The tests that run the engine need NLPPlus in the Python running them, and are
skipped without it.
"""
import importlib.util
import json
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from argparse import Namespace
from pathlib import Path

import nlp_run
from nlp_run import RunError

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "hello-studio"
TEXT = "hello world. Hi there, and hey everyone!\n"
HAVE_ENGINE = importlib.util.find_spec("NLPPlus") is not None
needs_engine = unittest.skipUnless(HAVE_ENGINE, "NLPPlus is not installed for this Python")


def sample_files() -> dict[str, str]:
    return {p.relative_to(SAMPLE).as_posix(): p.read_text(encoding="utf-8", errors="replace")
            for p in sorted(SAMPLE.rglob("*"))
            if p.is_file() and p.relative_to(SAMPLE).parts[0] in ("spec", "kb")}


class Requests(unittest.TestCase):
    def test_paths_outside_an_analyzer_are_refused(self):
        for bad in ["../x", "spec/../../x", "/etc/passwd", "bin/run.dll", "spec//a.nlp", "spec/a\\..\\b",
                    "C:/x", "spec/ a.nlp", "spec/con.nlp", "spec"]:
            with self.subTest(path=bad), self.assertRaises(RunError):
                nlp_run.validate({"spec/analyzer.seq": "", bad: ""}, "")

    def test_an_analyzer_needs_its_sequence(self):
        with self.assertRaises(RunError):
            nlp_run.validate({"spec/rules.nlp": ""}, "")

    def test_text_and_files_must_be_text(self):
        for files, text in [([], ""), ({"spec/analyzer.seq": 1}, ""), ({"spec/analyzer.seq": ""}, None)]:
            with self.subTest(files=files, text=text), self.assertRaises(RunError):
                nlp_run.validate(files, text)

    def test_too_much_text_is_refused(self):
        with self.assertRaises(RunError):
            nlp_run.validate({"spec/analyzer.seq": ""}, "x" * (nlp_run.MAX_TEXT_BYTES + 1))


class Reading(unittest.TestCase):
    def test_passes_are_numbered_as_the_engine_numbers_them(self):
        seq = ("# a comment\ntokenize\tnil\n/nlp\toff\t# switched off\nfolder\tgroup\nnlp\tgreeting\n"
               "end\tgroup\nstub\tlater\nend\tlater\nrec\tloop\nnlp\toutput\t# writes output.json\n")
        files = ["spec/greeting.nlp", "spec/off.nlp", "spec/loop.pat", "spec/output.nlp"]
        # Measured on NLPPlus 2.2.37: an error in the pass after "/nlp off" comes back
        # one higher than without it; after a folder or a stub, it does not.
        self.assertEqual(nlp_run.pass_files(seq, files),
                         {1: None, 2: "spec/off.nlp", 3: "spec/greeting.nlp", 4: "spec/loop.pat", 5: "spec/output.nlp"})

    def test_log_lines_become_problems_in_pass_files(self):
        log = ("0 0 [Date: 09:32:33 09/15/26]\n0 0 [Build analyzer time=0.004 sec]\n"
               "4 2 [Fncall: Error: Unknown fn/action name=X]\n0 0 [Errors in loading analyzer.]\n")
        self.assertEqual(nlp_run.parse_log(log, {4: "spec/output.nlp"}), [
            {"file": "spec/output.nlp", "pass": 4, "line": 2, "message": "Fncall: Error: Unknown fn/action name=X"},
            {"file": None, "pass": 0, "line": 0, "message": "Errors in loading analyzer."},
        ])

    def test_engine_noise_is_left_out_of_the_log(self):
        stdout = ("[logfile: x]\n[analyzer name: a]\n0 0 [Exec analyzer time=0.005 sec]\n"
                  "[dict_add_word: Failed on name=count]\n" + nlp_run.DONE + "\n")
        self.assertEqual(nlp_run.engine_log(stdout), ["[dict_add_word: Failed on name=count]"])


class Policy(unittest.TestCase):
    def calls(self, code: str) -> list[dict]:
        files = {"spec/analyzer.seq": "tokenize\tnil\nnlp\toutput\n", "spec/output.nlp": code}
        return nlp_run.blocked_calls(files, nlp_run.pass_files(files["spec/analyzer.seq"], files))

    def test_a_blocked_call_is_found_on_its_line(self):
        self.assertEqual(self.calls('@CODE\nL("x") = 1;\nsystem("echo hi");\n@@CODE\n'), [
            {"file": "spec/output.nlp", "pass": 2, "line": 3, "message": "system() is not allowed on the run server."},
        ])

    def test_comments_and_strings_are_not_calls(self):
        self.assertEqual(self.calls('@CODE\n# system("x")\nL("s") = "system(1)";\n/* urltofile(\n) */\n@@CODE\n'), [])

    def test_an_escaped_hash_does_not_hide_a_call(self):
        self.assertEqual([p["line"] for p in self.calls('@CODE\nL("a") = "\\#"; \\# SYSTEM ("x");\n@@CODE\n')], [2])

    def test_file_functions_stay_allowed(self):
        self.assertEqual(self.calls('@CODE\nL("f") = openfile("output.json");\nmkdir("kb");\n@@CODE\n'), [])


@needs_engine
class Runs(unittest.TestCase):
    def test_the_sample_runs_to_its_output_and_tree(self):
        result = nlp_run.run(sample_files(), TEXT)
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(list(result["output"]), ["output.json"])
        self.assertEqual(json.loads(result["output"]["output.json"]), {"greetings": 3})
        self.assertEqual(result["tree"].count("_greeting ["), 3)
        self.assertEqual(result["problems"], [])

    def test_a_run_error_names_the_pass_file_and_line(self):
        files = sample_files() | {"spec/output.nlp": "@CODE\nNoSuchFunction(1);\n@@CODE\n"}
        result = nlp_run.run(files, TEXT)
        self.assertEqual(result["status"], "ok", result)
        self.assertIn(("spec/output.nlp", 2), {(p["file"], p["line"]) for p in result["problems"]})
        self.assertTrue(any("Unknown fn" in p["message"] for p in result["problems"]))

    def test_a_syntax_error_fails_the_build_and_names_its_line(self):
        broken = "@NODES _ROOT\n\n@RULES\n_greeting <-\n\t_xWILD [one match=(hello hi]\n\t@@\n"
        result = nlp_run.run(sample_files() | {"spec/greeting.nlp": broken}, TEXT)
        self.assertEqual(result["status"], "failed", result)
        self.assertIn({"file": "spec/greeting.nlp", "pass": 3, "line": 5, "message": "Syntax error."}, result["problems"])
        self.assertIsNone(result["tree"])

    def test_an_endless_loop_is_stopped(self):
        loop = '@CODE\nL("i") = 0;\nwhile (1) { L("i")++; }\n@@CODE\n'
        started = time.monotonic()
        result = nlp_run.run(sample_files() | {"spec/output.nlp": loop}, TEXT, timeout=3)
        self.assertEqual(result["status"], "timeout", result)
        self.assertLess(time.monotonic() - started, 10)

    def test_an_engine_crash_is_reported_not_raised(self):
        files = {k: v for k, v in sample_files().items() if k != "kb/user/hier.kb"}
        result = nlp_run.run(files, TEXT)
        self.assertEqual(result["status"], "crashed", result)
        self.assertIn("dict_add_word", result["message"] + "\n".join(result["log"]))

    def test_a_blocked_call_is_refused_without_running(self):
        files = sample_files() | {"spec/output.nlp": '@CODE\nsystem("echo hi");\n@@CODE\n'}
        result = nlp_run.run(files, TEXT)
        self.assertEqual(result["status"], "rejected", result)
        self.assertEqual(result["tree"], None)
        self.assertEqual([(p["file"], p["line"]) for p in result["problems"]], [("spec/output.nlp", 2)])


@needs_engine
class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app
        opts = Namespace(host="127.0.0.1", port=0, dist=None, timeout=10.0, max_runs=1, queue_wait=5.0,
                         python=sys.executable, quiet=True)
        cls.server = app.RunServer(("127.0.0.1", 0), opts)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, path: str, body: bytes | None = None) -> tuple[int, bytes]:
        req = urllib.request.Request(self.base + path, data=body, method="POST" if body is not None else "GET",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.read()

    def test_health_names_the_engine(self):
        code, body = self.request("/api/health")
        health = json.loads(body)
        self.assertEqual((code, health["ok"], health["maxRuns"]), (200, True, 1))
        self.assertRegex(health["engine"], r"^\d+\.\d+")

    def test_a_run_over_http(self):
        code, body = self.request("/api/run", json.dumps({"files": sample_files(), "text": TEXT}).encode())
        result = json.loads(body)
        self.assertEqual((code, result["status"]), (200, "ok"))
        self.assertEqual(json.loads(result["output"]["output.json"]), {"greetings": 3})
        self.assertEqual(result["engine"], self.server.engine)

    def test_bad_requests_are_400_and_say_why(self):
        for body in [b"not json", b"[]", json.dumps({"files": {"../x": ""}, "text": ""}).encode()]:
            with self.subTest(body=body[:20]):
                code, answer = self.request("/api/run", body)
                self.assertEqual((code, json.loads(answer)["status"]), (400, "invalid"))

    def test_no_site_without_dist(self):
        self.assertEqual(self.request("/")[0], 404)
        self.assertEqual(self.request("/api/nothing")[0], 404)


if __name__ == "__main__":
    unittest.main()
