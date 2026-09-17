// @vitest-environment node
// The rules with no DOM at all, as a server or another page would use them.
import { describe, expect, it } from "vitest";
import {
	fileIcon, fileSize, outputOrder, passComment, passIcon, passLabel, passTooltip, passes, shownInKnowledgeBase,
	langFor, logLines, problemWhere, problemsInLog, treeLabel, treeNote, treeOrder, treeTitle,
} from "../src/rules.js";

describe("analyzer.seq", () => {
	const files = ["spec/analyzer.seq", "spec/funcs.nlp", "spec/old.pat", "spec/off.nlp", "spec/inner.nlp"];
	const seq = [
		"tokenize\tnil\t# Split the text into tokens",
		"# a comment line",
		"nlp\tfuncs\t# helpers",
		"/nlp\toff\t# switched off",
		"folder\tgroup",
		"pat\told",
		"nlp\tinner\t# comment",
		"end\tgroup",
		"nlp\tmissing\t# no file for this one",
	].join("\r\n");

	// The engine's numbering, which run problems and tree nodes use: measured on
	// NLPPlus 2.2.37, a switched-off pass keeps its number and a folder takes none.
	it("lists passes in run order, numbered as the engine numbers them", () => {
		expect(passes(seq, files).map((p) => [p.n, p.kind, p.name, p.active])).toEqual([
			[1, "tokenize", "nil", true],
			[2, "nlp", "funcs", true],
			[3, "nlp", "off", false],
			[null, "folder", "group", true],
			[4, "pat", "old", true],
			[5, "nlp", "inner", true],
			[6, "nlp", "missing", true],
		]);
	});
	it("names each pass's rule file when the analyzer has it", () => {
		expect(passes(seq, files).map((p) => p.file))
			.toEqual([null, "spec/funcs.nlp", "spec/off.nlp", null, "spec/old.pat", "spec/inner.nlp", null]);
	});
	it("says which folder a pass sits in, until its end line", () => {
		expect(passes(seq, files).map((p) => p.folder)).toEqual([null, null, null, null, "group", "group", null]);
	});
	it("keeps the comment", () => {
		expect(passes(seq, files)[0].comment).toBe("Split the text into tokens");
	});
	it("takes a stub as a group, like a folder", () => {
		const stubbed = passes("stub\tlater\nnlp\tfuncs\nend\tlater\nnlp\tafter", ["spec/funcs.nlp"]);
		expect(stubbed.map((p) => [p.n, p.name, p.folder])).toEqual([[null, "later", null], [1, "funcs", "later"], [2, "after", null]]);
	});
});

describe("a pass's tooltip and label", () => {
	it("strips the comment's markers, and the extension's placeholder says nothing", () => {
		expect([passComment("# find the dates"), passComment("/* find the dates */"), passComment("# comment"), passComment("  ")])
			.toEqual(["find the dates", "find the dates", "", ""]);
	});
	it("falls back to the file, then the kind", () => {
		expect(passTooltip({ comment: "# comment", file: "spec/dates.nlp", kind: "nlp" })).toBe("spec/dates.nlp");
		expect(passTooltip({ comment: "", file: null, kind: "tokenize" })).toBe("tokenize");
	});
	it("names a rule pass or a folder by its name, and a built-in pass by what it does", () => {
		expect([
			passLabel({ file: "spec/funcs.nlp", kind: "nlp", name: "funcs" }),
			passLabel({ file: null, kind: "folder", name: "group" }),
			passLabel({ file: null, kind: "tokenize", name: "nil" }),
		]).toEqual(["funcs", "group", "tokenize"]);
	});
});

describe("icons", () => {
	it("gives a pass the extension's icon for its kind", () => {
		expect([passIcon("nlp", true), passIcon("nlp", false), passIcon("rec", true), passIcon("folder", true),
			passIcon("folder", false), passIcon("tokenize", true), passIcon("stub", true), passIcon("PAT", true)])
			.toEqual(["dna", "dna-off", "dnar", "folder", "folder-off", "dot", "dot", "dna"]);
	});
	it("gives a file the icon for its extension", () => {
		expect(["a.dict", "b.KBB", "output.json", "err.log", "final.tree", "input.txt"].map(fileIcon))
			.toEqual(["dict", "kbb", "json", "log", "tree", "file"]);
	});
});

describe("the knowledge base", () => {
	it("lists dictionaries and .kbb files, never the engine's .kb files", () => {
		const files = [
			"kb/user/hier.kb", "kb/user/word.kb", "kb/user/attr.KB", "kb/user/phr.kb",
			"kb/user/colors.dict", "kb/user/en-full.DICT", "kb/user/facts.kbb", "kb/user/notes.txt",
			"spec/analyzer.seq", "input/words.dict",
		];
		expect(files.filter(shownInKnowledgeBase)).toEqual(["kb/user/colors.dict", "kb/user/en-full.DICT", "kb/user/facts.kbb"]);
	});
	it("prints a size, and nothing for one it does not know", () => {
		expect([fileSize(3000), fileSize(100), fileSize(2.5 * 1024 * 1024), fileSize(0), fileSize(undefined)])
			.toEqual(["3 KB", "1 KB", "2.5 MB", "", ""]);
	});
});

describe("what a run wrote", () => {
	it("lists output files by name", () => {
		expect(outputOrder(["output.json", { path: "err.log", bytes: 10 }, "a.txt"]).map((f) => f.path))
			.toEqual(["a.txt", "err.log", "output.json"]);
	});
	const trees = [
		{ name: "ana002.tree", pass: 2, passName: "funcs", bytes: 5000 },
		{ name: "final.tree", pass: null, bytes: 12000 },
		{ name: "ana001.tree", pass: 1, passName: null },
	];
	it("puts the final tree first, then the tree after each pass in order", () => {
		expect(treeOrder(trees).map((t) => t.name)).toEqual(["final.tree", "ana001.tree", "ana002.tree"]);
	});
	it("names a tree by the pass it was written after", () => {
		expect(treeOrder(trees).map(treeLabel)).toEqual(["final", "1", "2 funcs"]);
		expect(treeOrder(trees).map(treeTitle))
			.toEqual(["final parse tree", "parse tree after pass 1", "parse tree after pass 2 (funcs)"]);
	});
	it("says when a tree was written, and its size when known", () => {
		expect(treeOrder(trees).map(treeNote)).toEqual(["after the last pass · 12 KB", "after pass 1", "after pass 2 · 5 KB"]);
	});
});

describe("which grammar reads a file", () => {
	it("goes by the file's extension, with .pat as a rule file", () => {
		expect(["spec/kbinit.nlp", "spec/old.PAT", "spec/analyzer.seq", "kb/user/hier.kb", "kb/user/a.kbb",
			"kb/user/b.dict", "final.tree", "input/a.txxt"].map(langFor))
			.toEqual(["nlp", "nlp", "seq", "kb", "kbb", "dict", "tree", "txxt"]);
	});
	it("gives a file that is not NLP++ none", () => {
		expect([langFor("README.md"), langFor("kb/user/.keep"), langFor(""), langFor(undefined)]).toEqual([null, null, null, null]);
	});
});

describe("the engine's log", () => {
	// The run server's own case (studio/server/test_nlp_run.py), so the two readings agree.
	const log = "0 0 [Date: 09:32:33 09/15/26]\n0 0 [Build analyzer time=0.004 sec]\n"
		+ "4 2 [Fncall: Error: Unknown fn/action name=X]\n0 0 [Errors in loading analyzer.]\n";
	const seq = "tokenize\tnil\n/nlp\toff\nnlp\tfuncs\nnlp\toutput";
	const files = ["spec/off.nlp", "spec/funcs.nlp", "spec/output.nlp"];

	it("finds the problems, each in its pass's file, and leaves out the timings and the date", () => {
		expect(problemsInLog(log, seq, files)).toEqual([
			{ file: "spec/output.nlp", pass: 4, line: 2, message: "Fncall: Error: Unknown fn/action name=X" },
			{ file: null, pass: 0, line: 0, message: "Errors in loading analyzer." },
		]);
	});
	it("says where a problem is", () => {
		expect([
			problemWhere({ file: "spec/output.nlp", pass: 4, line: 2 }),
			problemWhere({ file: null, pass: 1, line: 3 }),
			problemWhere({ file: null, pass: 0, line: 0 }),
		]).toEqual(["spec/output.nlp:2", "pass 1", "analyzer"]);
	});
	it("reads a log as its lines, without the blank ones", () => {
		expect(logLines("a\r\n\n  \nb")).toEqual(["a", "b"]);
		expect(logLines(["a", "", "b"])).toEqual(["a", "b"]);
		expect(logLines(null)).toEqual([]);
	});
});
