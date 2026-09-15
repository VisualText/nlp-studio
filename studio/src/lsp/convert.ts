// Between the language server's shapes and Monaco's.
//
// PURE: no Monaco import, so the arithmetic that is easy to get wrong -- LSP
// counts lines and characters from 0, Monaco from 1 -- is tested in plain Node.
// Enums are mapped to Monaco's member NAMES here and looked up on the monaco
// namespace by the caller (monacoLsp.ts), for the same reason.

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface MonacoPosition { lineNumber: number; column: number }
export interface MonacoRange {
	startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number;
}

export function toMonacoRange(r: LspRange): MonacoRange {
	return {
		startLineNumber: r.start.line + 1, startColumn: r.start.character + 1,
		endLineNumber: r.end.line + 1, endColumn: r.end.character + 1,
	};
}

export function toLspPosition(p: MonacoPosition): LspPosition {
	return { line: p.lineNumber - 1, character: p.column - 1 };
}

export function toLspRange(r: MonacoRange): LspRange {
	return {
		start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
		end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
	};
}

// LSP CompletionItemKind (1-25) -> monaco.languages.CompletionItemKind member.
const COMPLETION_KINDS = [
	"Text", "Method", "Function", "Constructor", "Field", "Variable", "Class", "Interface",
	"Module", "Property", "Unit", "Value", "Enum", "Keyword", "Snippet", "Color", "File",
	"Reference", "Folder", "EnumMember", "Constant", "Struct", "Event", "Operator", "TypeParameter",
] as const;
export type CompletionKindName = (typeof COMPLETION_KINDS)[number];
export function completionKindName(kind: number | undefined): CompletionKindName {
	return COMPLETION_KINDS[(kind ?? 1) - 1] ?? "Text";
}

// LSP SymbolKind (1-26) -> monaco.languages.SymbolKind, which is the same list from 0.
export function monacoSymbolKind(kind: number): number {
	return Math.max(0, Math.min(25, kind - 1));
}

// LSP DiagnosticSeverity (1 Error .. 4 Hint) -> monaco.MarkerSeverity (8, 4, 2, 1).
export function markerSeverity(severity: number | undefined): number {
	return ({ 1: 8, 2: 4, 3: 2, 4: 1 } as Record<number, number>)[severity ?? 1] ?? 8;
}

// A hover's contents, in any of the shapes the protocol allows, as one markdown string.
type MarkedString = string | { language: string; value: string };
export function hoverMarkdown(contents: MarkedString | MarkedString[] | { kind: string; value: string }): string {
	const one = (c: MarkedString | { kind: string; value: string }): string =>
		typeof c === "string" ? c
			: "language" in c ? "```" + c.language + "\n" + c.value + "\n```"
			: c.value;
	return Array.isArray(contents) ? contents.map(one).join("\n\n") : one(contents);
}

// The server's built-in hovers link to the extension's help view with a command: URI,
// which only VS Code can run. A dead link reads as a broken page, so it goes.
export function withoutCommandLinks(markdown: string): string {
	return markdown
		.replace(/\[[^\]]*\]\(command:[^)]*\)/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// Which Monaco language a file is, by its name -- the grammars' own file types.
const LANGUAGES: Record<string, string> = {
	nlp: "nlp", pat: "nlp", seq: "seq", kb: "kb", kbb: "kbb", dict: "dict", tree: "tree", txxt: "txxt",
};
export function languageFor(path: string): string {
	const name = path.toLowerCase().split("/").pop() ?? "";
	const ext = name.includes(".") ? name.split(".").pop()! : "";
	return LANGUAGES[ext] ?? "plaintext";
}

// The language server answers for rule files only; the other types get colour, not features.
export function servedByLanguageServer(path: string): boolean {
	return languageFor(path) === "nlp";
}
