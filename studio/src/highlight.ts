// NLP++ colouring in Monaco, from the language's own TextMate grammars.
//
// The grammars are the VS Code extension's (src/grammars, from nlpplus-tmbundle).
// Monaco does not read TextMate grammars itself, so shiki tokenises with them --
// its JavaScript regex engine, which compiles all seven with nothing dropped --
// and @shikijs/monaco hands the tokens and the two themes to Monaco.
import { createHighlighterCore, type LanguageRegistration } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { shikiToMonaco } from "@shikijs/monaco";
import { monaco } from "./monaco";
import nlp from "./grammars/nlp.tmLanguage.json";
import seq from "./grammars/seq.tmLanguage.json";
import kb from "./grammars/kb.tmLanguage.json";
import kbb from "./grammars/kbb.tmLanguage.json";
import dict from "./grammars/dict.tmLanguage.json";
import tree from "./grammars/tree.tmLanguage.json";
import txxt from "./grammars/txxt.tmLanguage.json";

const GRAMMARS: Record<string, unknown> = { nlp, seq, kb, kbb, dict, tree, txxt };
export const LANGUAGE_IDS = Object.keys(GRAMMARS);
export const THEMES = { light: "light-plus", dark: "dark-plus" } as const;

// The language server's word pattern (src/server/serverCore.ts WORD_PATTERN in
// vscode-nlp), so Monaco and the server agree on what one identifier is.
const WORD_PATTERN = /(-?\d*\.\d\w*)|([^`~!@#%^&*()=+[{\]}\\|;:'",.<>/?\s]+)/;

export async function installHighlighting(): Promise<void> {
	for (const id of LANGUAGE_IDS) monaco.languages.register({ id });
	monaco.languages.setLanguageConfiguration("nlp", {
		wordPattern: WORD_PATTERN,
		comments: { lineComment: "#", blockComment: ["/*", "*/"] },
		brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
		autoClosingPairs: [
			{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" },
			{ open: "\"", close: "\"", notIn: ["string", "comment"] },
		],
	});

	const highlighter = await createHighlighterCore({
		themes: [import("@shikijs/themes/light-plus"), import("@shikijs/themes/dark-plus")],
		langs: LANGUAGE_IDS.map((id) => ({ ...(GRAMMARS[id] as object), name: id }) as LanguageRegistration),
		engine: createJavaScriptRegexEngine(),
	});
	// @shikijs/monaco is typed against monaco-editor-core; this is the same API.
	shikiToMonaco(highlighter, monaco as never);
}
