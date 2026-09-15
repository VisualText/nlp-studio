"""Keeping runs' parse trees for the page to open (trees.py). No engine needed."""
import tempfile
import time
import unittest
from pathlib import Path

from trees import TreeStore


def output_folder(files: dict[str, str]) -> Path:
    folder = Path(tempfile.mkdtemp(prefix="trees-test-out-"))
    for name, text in files.items():
        (folder / name).write_text(text, encoding="utf-8")
    return folder


class Keeping(unittest.TestCase):
    def setUp(self):
        self.store = TreeStore(tempfile.mkdtemp(prefix="trees-test-store-"))

    def test_only_tree_files_are_kept_and_listed_in_order(self):
        out = output_folder({"final.tree": "FINAL", "ana002.tree": "two", "ana001.tree": "one",
                             "output.json": "{}", "err.log": "", "ana1.tree.bak": "x"})
        kept = self.store.keep(out, owner=None)
        self.assertEqual([f["name"] for f in kept["files"]], ["ana001.tree", "ana002.tree", "final.tree"])
        self.assertEqual(kept["skipped"], [])
        self.assertEqual(sorted(p.name for p in out.iterdir()), ["ana1.tree.bak", "err.log", "output.json"])
        self.assertEqual(self.store.path(kept["run"], "ana002.tree", None).read_text(), "two")

    def test_a_run_without_trees_keeps_nothing(self):
        self.assertIsNone(self.store.keep(output_folder({"output.json": "{}"}), owner=None))
        self.assertIsNone(self.store.keep(Path(tempfile.mkdtemp()) / "missing", owner=None))

    def test_only_the_owner_reads_a_run_s_trees(self):
        kept = self.store.keep(output_folder({"final.tree": "mine"}), owner="octocat")
        self.assertIsNotNone(self.store.path(kept["run"], "final.tree", "octocat"))
        self.assertIsNone(self.store.path(kept["run"], "final.tree", "mallory"))
        self.assertIsNone(self.store.path(kept["run"], "final.tree", None))

    def test_names_that_are_not_trees_are_refused(self):
        kept = self.store.keep(output_folder({"final.tree": "x"}), owner=None)
        for name in ["../final.tree", "output.json", "final.tree/..", "", "ana.tree"]:
            with self.subTest(name=name):
                self.assertIsNone(self.store.path(kept["run"], name, None))
        self.assertIsNone(self.store.path("no-such-run", "final.tree", None))

    def test_old_runs_are_let_go(self):
        store = TreeStore(tempfile.mkdtemp(prefix="trees-test-store-"), keep_seconds=0.2)
        kept = store.keep(output_folder({"final.tree": "x"}), owner=None)
        time.sleep(0.4)
        self.assertIsNone(store.path(kept["run"], "final.tree", None))
        self.assertFalse((store.root / kept["run"]).exists())

    def test_the_oldest_runs_go_first_past_the_limit(self):
        store = TreeStore(tempfile.mkdtemp(prefix="trees-test-store-"), max_runs=2)
        runs = []
        for i in range(3):
            runs.append(store.keep(output_folder({"final.tree": f"run {i}"}), owner=None)["run"])
            time.sleep(0.01)
        self.assertIsNone(store.path(runs[0], "final.tree", None))
        self.assertEqual(store.path(runs[2], "final.tree", None).read_text(), "run 2")

    def test_one_run_takes_at_most_half_the_space_keeping_its_final_tree(self):
        store = TreeStore(tempfile.mkdtemp(prefix="trees-test-store-"), max_bytes=100)
        kept = store.keep(output_folder({"final.tree": "f" * 20, "ana001.tree": "a" * 20, "ana002.tree": "b" * 20}), owner=None)
        self.assertEqual([f["name"] for f in kept["files"]], ["ana001.tree", "final.tree"])
        self.assertEqual(kept["skipped"], ["ana002.tree"])


if __name__ == "__main__":
    unittest.main()
