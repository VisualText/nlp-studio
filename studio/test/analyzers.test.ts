import { describe, expect, it } from "vitest";
import { fileUri, passes, pathOf, ROOT_URI } from "../src/analyzers";

describe("analyzer files as URIs", () => {
	it("puts every file under the one workspace folder", () => {
		expect(fileUri("hello-studio", "spec/funcs.nlp")).toBe(`${ROOT_URI}/hello-studio/spec/funcs.nlp`);
	});
	it("reads a path back, and nothing from another analyzer", () => {
		const uri = fileUri("hello-studio", "spec/funcs.nlp");
		expect(pathOf(uri, "hello-studio")).toBe("spec/funcs.nlp");
		expect(pathOf(uri, "hello")).toBeUndefined();
	});
});

describe("analyzer.seq", () => {
	const files = ["spec/analyzer.seq", "spec/funcs.nlp", "spec/old.pat", "spec/off.nlp"];
	const seq = [
		"tokenize\tnil\t# Split the text into tokens",
		"# a comment line",
		"nlp\tfuncs\t# helpers",
		"/nlp\toff\t# switched off",
		"folder\tgroup",
		"pat\told",
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
			[5, "nlp", "missing", true],
		]);
	});
	it("names each pass's rule file when the analyzer has it", () => {
		expect(passes(seq, files).map((p) => p.file))
			.toEqual([null, "spec/funcs.nlp", "spec/off.nlp", null, "spec/old.pat", null]);
	});
	it("keeps the comment", () => {
		expect(passes(seq, files)[0].comment).toBe("Split the text into tokens");
	});
});
