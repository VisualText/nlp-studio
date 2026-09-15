import { describe, expect, it } from "vitest";
import {
	completionKindName, hoverMarkdown, languageFor, markerSeverity, monacoSymbolKind,
	servedByLanguageServer, toLspPosition, toLspRange, toMonacoRange, withoutCommandLinks,
} from "../src/lsp/convert";

describe("positions and ranges", () => {
	it("counts from 1 in Monaco and from 0 in LSP", () => {
		expect(toMonacoRange({ start: { line: 0, character: 0 }, end: { line: 2, character: 5 } }))
			.toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 6 });
		expect(toLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 });
	});
	it("round-trips a range", () => {
		const r = { start: { line: 4, character: 2 }, end: { line: 4, character: 13 } };
		expect(toLspRange(toMonacoRange(r))).toEqual(r);
	});
});

describe("kinds and severities", () => {
	it("maps completion kinds by name, falling back to Text", () => {
		expect([completionKindName(3), completionKindName(14), completionKindName(7)])
			.toEqual(["Function", "Keyword", "Class"]);
		expect([completionKindName(undefined), completionKindName(99)]).toEqual(["Text", "Text"]);
	});
	it("shifts symbol kinds to Monaco's zero-based list", () => {
		expect([monacoSymbolKind(1), monacoSymbolKind(12), monacoSymbolKind(26)]).toEqual([0, 11, 25]);
	});
	it("maps diagnostic severities onto marker severities", () => {
		expect([1, 2, 3, 4, undefined].map(markerSeverity)).toEqual([8, 4, 2, 1, 8]);
	});
});

describe("hovers", () => {
	it("reads every shape the protocol allows", () => {
		expect(hoverMarkdown({ kind: "markdown", value: "**x**" })).toBe("**x**");
		expect(hoverMarkdown(["a", { language: "nlp", value: "G(\"x\")" }]))
			.toBe("a\n\n```nlp\nG(\"x\")\n```");
	});
	it("drops the extension's command links, which a browser cannot run", () => {
		const md = "**strval** — NLP++ built-in function\n\n[Open help for `strval`](command:helpView.openFunctionPage?%5B%22strval%22%5D)";
		expect(withoutCommandLinks(md)).toBe("**strval** — NLP++ built-in function");
	});
});

describe("languages", () => {
	it("picks the grammar by file name", () => {
		expect(["spec/a.nlp", "spec/b.PAT", "spec/analyzer.seq", "kb/user/hier.kb", "x.kbb", "x.dict", "final.tree", "input/a.txt"]
			.map(languageFor)).toEqual(["nlp", "nlp", "seq", "kb", "kbb", "dict", "tree", "plaintext"]);
	});
	it("sends only rule files to the language server", () => {
		expect([servedByLanguageServer("spec/a.nlp"), servedByLanguageServer("spec/analyzer.seq")])
			.toEqual([true, false]);
	});
});
