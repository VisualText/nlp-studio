// @vitest-environment node
// The rules with no DOM at all, as a server or another page would use them.
import { describe, expect, it } from "vitest";
import {
	fileIcon, fileSize, passComment, passIcon, passLabel, passTooltip, passes, shownInKnowledgeBase,
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
