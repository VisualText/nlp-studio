// The colours VisualText gives NLP++ tokens, as the VS Code extension sets them.
//
// The extension's grammars name scopes of their own -- keyword.node.tree,
// keyword.rewrite.tree, keyword.concept.kbb2 -- which no theme knows, so VS Code themes
// would colour them all as plain keywords. The extension therefore ships
// editor.tokenColorCustomizations in the .vscode/settings.json of its repository and of
// the analyzer repositories (vscode-nlp/.vscode/settings.json), with one set of rules for
// light themes and one for dark. Parse trees are the clearest case: node names green,
// rewrites bold, offsets blue, "fired" red.
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
	{ scope: "variable.parameter.nlp", settings: { foreground: "#696969", fontStyle: "bold" } },
	{ scope: "keyword.attribute.nlp", settings: { foreground: "#e655f3" } },
	{ scope: "keyword.constants.nlp", settings: { foreground: "#0a7b83", fontStyle: "bold" } },
	{ scope: ["keyword.operator.nlp", "keyword.operator.word.nlp"], settings: { foreground: "#1f6feb" } },
	{ scope: "constant.numeric.tree", settings: { foreground: "#5596f0" } },
	{ scope: "keyword.fired.tree", settings: { foreground: "#dc1b1b", fontStyle: "bold" } },
	{ scope: "keyword.rewrite.tree", settings: { foreground: "#000000", fontStyle: "bold" } },
	{ scope: "keyword.node.tree", settings: { foreground: "#4e8e3c", fontStyle: "bold" } },
	{ scope: "source.txxt", settings: { foreground: "#a5a5a5" } },
	{ scope: "keyword.other.txxt", settings: { foreground: "#6e60eb", fontStyle: "bold" } },
	{ scope: "comment.line.txxt", settings: { foreground: "#dd2c2c", fontStyle: "bold" } },
	{ scope: "variable.parameter.txxt", settings: { foreground: "#535353", fontStyle: "bold" } },
	{ scope: "keyword.other.kbb", settings: { foreground: "#5d00d6", fontStyle: "bold" } },
	{ scope: "keyword.concept.kbb", settings: { foreground: "#7e7e7e", fontStyle: "bold" } },
	{ scope: "keyword.concept.kbb1", settings: { foreground: "#2eb657", fontStyle: "bold" } },
	{ scope: "keyword.concept.kbb2", settings: { foreground: "#e049d9", fontStyle: "bold" } },
];

export const DARK_RULES: TokenRule[] = [
	{ scope: "entity.name.function.letter.nlp", settings: { foreground: "#dc1b1b" } },
	{ scope: "entity.name.function.nlp", settings: { foreground: "#8f8f8f", fontStyle: "bold" } },
	{ scope: "variable.parameter.nlp", settings: { foreground: "#f8fa87", fontStyle: "bold" } },
	{ scope: "keyword.attribute.nlp", settings: { foreground: "#f293fb" } },
	{ scope: "keyword.constants.nlp", settings: { foreground: "#4ec9b0", fontStyle: "bold" } },
	{ scope: ["keyword.operator.nlp", "keyword.operator.word.nlp"], settings: { foreground: "#8ab4f8" } },
	{ scope: "constant.numeric.tree", settings: { foreground: "#93bffb" } },
	{ scope: "keyword.fired.tree", settings: { foreground: "#dc1b1b", fontStyle: "bold" } },
	{ scope: "keyword.rewrite.tree", settings: { foreground: "#f8fa87", fontStyle: "bold" } },
	{ scope: "keyword.node.tree", settings: { foreground: "#4e8e3c", fontStyle: "bold" } },
	{ scope: "source.txxt", settings: { foreground: "#7e7e7e" } },
	{ scope: "variable.parameter.txxt", settings: { foreground: "#f8fa87" } },
	{ scope: "keyword.other.kbb", settings: { foreground: "#896eff", fontStyle: "bold" } },
	{ scope: "keyword.concept.kbb", settings: { foreground: "#e3ee50", fontStyle: "bold" } },
	{ scope: "keyword.concept.kbb1", settings: { foreground: "#2eb657", fontStyle: "bold" } },
	{ scope: "keyword.concept.kbb2", settings: { foreground: "#e049d9", fontStyle: "bold" } },
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
