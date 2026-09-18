import { describe, expect, it } from "vitest";

import type { RunResult } from "../src/run/api";
import { passTrees, resultTone, valuesOutput, viewTrees } from "../src/try/result";

// A debug run of an analyzer with a switched-off pass: the engine keeps final.tree and
// a tree after each pass that actually ran. Pass 3 is "/nlp anaphoraSearch", which keeps
// its number and writes nothing -- as VisualText/analyzers' business analyzer does.
const RESULT = {
	status: "ok",
	message: "Ran.",
	trees: {
		run: "r1",
		files: [
			{ name: "final.tree", pass: null, passName: null, file: null, size: 4200 },
			{ name: "ana001.tree", pass: 1, passName: "tokenize", file: null, size: 120 },
			{ name: "ana002.tree", pass: 2, passName: "words", file: "spec/words.nlp", size: 340 },
			{ name: "ana004.tree", pass: 4, passName: "events", file: "spec/events.nlp", size: 900 },
		],
		skipped: ["ana005.tree"],
	},
} as unknown as RunResult;

describe("viewTrees", () => {
	it("carries the server's size across as the views' bytes", () => {
		expect(viewTrees(RESULT)).toEqual([
			{ name: "final.tree", pass: null, passName: null, bytes: 4200 },
			{ name: "ana001.tree", pass: 1, passName: "tokenize", bytes: 120 },
			{ name: "ana002.tree", pass: 2, passName: "words", bytes: 340 },
			{ name: "ana004.tree", pass: 4, passName: "events", bytes: 900 },
		]);
	});

	it("is empty for a run that kept no trees, rather than throwing", () => {
		expect(viewTrees({ status: "ok", message: "Ran." } as RunResult)).toEqual([]);
		expect(viewTrees(null)).toEqual([]);
	});
});

describe("passTrees", () => {
	it("leaves final.tree out, so it cannot land on a pass", () => {
		expect(passTrees(viewTrees(RESULT)).map((t) => t.name))
			.toEqual(["ana001.tree", "ana002.tree", "ana004.tree"]);
	});

	it("keeps the engine's own numbering, gaps and all", () => {
		// 3 is missing because that pass is switched off. Renumbering 4 to 3 here would
		// label every tree and problem after it with the wrong pass.
		expect(passTrees(viewTrees(RESULT)).map((t) => t.pass)).toEqual([1, 2, 4]);
	});
});

describe("resultTone", () => {
	it("says nothing about a run that worked", () => {
		expect(resultTone("ok")).toBe("");
	});

	it("treats an analyzer that reported problems as the analyzer's news", () => {
		expect(resultTone("failed")).toBe("warn");
	});

	it("treats everything else as the page failing to do what was asked", () => {
		for (const status of ["timeout", "crashed", "rejected", "busy", "invalid",
			"unauthorized", "unavailable"] as const) {
			expect(resultTone(status)).toBe("bad");
		}
	});
});

describe("valuesOutput", () => {
	it("unwraps readOutput, so a field is not listed as output.greetings", () => {
		const result = { output: { "output.json": '{"greetings": 3}' } } as unknown as RunResult;
		expect(valuesOutput(result)).toEqual({ output: { greetings: 3 }, error: null });
	});

	it("has nothing to list when the analyzer wrote no output.json", () => {
		// Most of VisualText's analyzers write .txt and .kbb files instead.
		const result = { output: { "anaphora.txt": "..." } } as unknown as RunResult;
		expect(valuesOutput(result)).toEqual({ output: null, error: null });
		expect(valuesOutput(null)).toEqual({ output: null, error: null });
	});

	it("says so when output.json is not JSON, rather than dropping it", () => {
		const result = { output: { "output.json": "{oops" } } as unknown as RunResult;
		const read = valuesOutput(result);
		expect(read.output).toBeNull();
		expect(read.error).toMatch(/not valid JSON/);
	});
});
