// NLP++ colouring in Monaco, from the language's own TextMate grammars.
//
// The grammars, the extension's colours for their scopes, and the shiki highlighter that
// tokenises with them are @visualtext/analyzer-views' (../analyzer-views/src/highlight.ts),
// the same ones <nlp-code> colours read-only text with, so a file reads the same in the
// editor and in any page that shows it. Monaco does not read TextMate grammars itself;
// @shikijs/monaco hands it the highlighter's tokens and both themes.
import { shikiToMonaco } from "@shikijs/monaco";
import { NLP_LANGUAGES, THEMES, nlpHighlighter } from "@visualtext/analyzer-views";
import { monaco } from "./monaco";

export const LANGUAGE_IDS: readonly string[] = NLP_LANGUAGES;
export { THEMES };

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

	const highlighter = await nlpHighlighter();
	// @shikijs/monaco is typed against monaco-editor-core; this is the same API.
	shikiToMonaco(highlighter, monaco as never);
}
