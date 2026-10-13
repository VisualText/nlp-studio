// The colours VisualText gives NLP++ tokens, as the VS Code extension sets them.
//
// The grammars use standard TextMate scope names (nlpplus-tmbundle#3), so any theme
// colours NLP++ reasonably. On top of that the extension ships its own
// editor.tokenColorCustomizations in the .vscode/settings.json of its repository and of
// the analyzer repositories (vscode-nlp/.vscode/settings.json), with one set of rules for
// light themes and one for dark. Parse trees are the clearest case: node names green,
// rewrites bold, offsets blue, "fired" red. A rule for an old scope name that covered
// several things lists all of their new names (vscode-nlp src/language/scopeMigration.ts).
//
// Copied from there rule for rule, so the two can be compared, and folded into the shiki
// themes in highlight.ts. PURE: no DOM.
export interface TokenRule {
	scope: string | string[];
	settings: { foreground?: string; fontStyle?: string };
}

export const LIGHT_RULES: TokenRule[] = [
	{ scope: "entity.name.function.letter.nlp", settings: { foreground: "#dc1b1b" } },
	{ scope: "entity.name.function.nlp", settings: { foreground: "#000000" } },
	{ scope: ["variable.parameter.nlp", "keyword.control.kb"], settings: { foreground: "#696969", fontStyle: "bold" } },
	{ scope: "entity.other.attribute-name.nlp", settings: { foreground: "#e655f3" } },
	{ scope: "constant.language.nlp", settings: { foreground: "#0a7b83", fontStyle: "bold" } },
	{ scope: ["keyword.operator.nlp", "keyword.operator.word.nlp"], settings: { foreground: "#1f6feb" } },
	{ scope: ["constant.numeric.tree", "constant.numeric.kbb"], settings: { foreground: "#5596f0" } },
	{ scope: "keyword.other.fired.tree", settings: { foreground: "#dc1b1b", fontStyle: "bold" } },
	{ scope: "entity.name.type.tree", settings: { foreground: "#000000", fontStyle: "bold" } },
	{ scope: "string.unquoted.token.tree", settings: { foreground: "#4e8e3c", fontStyle: "bold" } },
	{ scope: "source.txxt", settings: { foreground: "#a5a5a5" } },
	{ scope: "keyword.other.txxt", settings: { foreground: "#6e60eb", fontStyle: "bold" } },
	{ scope: "comment.line.txxt", settings: { foreground: "#dd2c2c", fontStyle: "bold" } },
	{ scope: "variable.parameter.txxt", settings: { foreground: "#535353", fontStyle: "bold" } },
	{ scope: "entity.name.type.level0.kbb", settings: { foreground: "#5d00d6", fontStyle: "bold" } },
	{ scope: "entity.name.type.level1.kbb", settings: { foreground: "#7e7e7e", fontStyle: "bold" } },
	{ scope: "entity.name.type.level2.kbb", settings: { foreground: "#2eb657", fontStyle: "bold" } },
	{ scope: "entity.name.type.level3.kbb", settings: { foreground: "#e049d9", fontStyle: "bold" } },
];

export const DARK_RULES: TokenRule[] = [
	{ scope: "entity.name.function.letter.nlp", settings: { foreground: "#dc1b1b" } },
	{ scope: "entity.name.function.nlp", settings: { foreground: "#8f8f8f", fontStyle: "bold" } },
	{ scope: ["variable.parameter.nlp", "keyword.control.kb"], settings: { foreground: "#f8fa87", fontStyle: "bold" } },
	{ scope: "entity.other.attribute-name.nlp", settings: { foreground: "#f293fb" } },
	{ scope: "constant.language.nlp", settings: { foreground: "#4ec9b0", fontStyle: "bold" } },
	{ scope: ["keyword.operator.nlp", "keyword.operator.word.nlp"], settings: { foreground: "#8ab4f8" } },
	{ scope: ["constant.numeric.tree", "constant.numeric.kbb"], settings: { foreground: "#93bffb" } },
	{ scope: "keyword.other.fired.tree", settings: { foreground: "#dc1b1b", fontStyle: "bold" } },
	{ scope: "entity.name.type.tree", settings: { foreground: "#f8fa87", fontStyle: "bold" } },
	{ scope: "string.unquoted.token.tree", settings: { foreground: "#4e8e3c", fontStyle: "bold" } },
	{ scope: "source.txxt", settings: { foreground: "#7e7e7e" } },
	{ scope: "variable.parameter.txxt", settings: { foreground: "#f8fa87" } },
	{ scope: "entity.name.type.level0.kbb", settings: { foreground: "#896eff", fontStyle: "bold" } },
	{ scope: "entity.name.type.level1.kbb", settings: { foreground: "#e3ee50", fontStyle: "bold" } },
	{ scope: "entity.name.type.level2.kbb", settings: { foreground: "#2eb657", fontStyle: "bold" } },
	{ scope: "entity.name.type.level3.kbb", settings: { foreground: "#e049d9", fontStyle: "bold" } },
];

// The tree scopes the extension's rules colour, for the self test to check they arrived.
export const TREE_COLORS = {
	node: "#4e8e3c",
	rewriteLight: "#000000",
	rewriteDark: "#f8fa87",
	numberLight: "#5596f0",
	numberDark: "#93bffb",
	fired: "#dc1b1b",
} as const;
