// NLP++ coloured by its own TextMate grammars, as the VS Code extension colours it.
//
// SHIKI, with its JavaScript regex engine: all seven grammars compile under it with
// nothing dropped, and there is no WebAssembly to serve. One highlighter for the page,
// loaded on first use -- the grammars and themes are chunks nobody pays for until code is
// on screen. <nlp-code> renders its tokens; NLP Studio hands the same highlighter to Monaco.
//
// THE EXTENSION'S COLOURS. The grammars name scopes of their own (keyword.node.tree,
// keyword.concept.kbb2, ...) that no stock theme knows, so the extension's rules for them
// (colors.ts) go into light-plus and dark-plus first.
//
// BOTH THEMES AT ONCE. Tokens carry their light and dark colours as --shiki-light and
// --shiki-dark, and style.css picks one, so a theme change repaints without tokenising.
import type { HighlighterCore, LanguageRegistration, ThemeRegistration, ThemedToken } from "@shikijs/core";
import { type TokenRule, DARK_RULES, LIGHT_RULES } from "./colors.js";
import { type NlpLanguage, NLP_LANGUAGES } from "./languages.js";

export const THEMES = { light: "light-plus", dark: "dark-plus" } as const;

// Past this the text shows plain: a document's parse tree runs to megabytes, and a span
// per token of that is a slower page than the colour is worth.
export const MAX_HIGHLIGHT_CHARS = 200_000;

// Explicit imports rather than a glob, so any bundler finds them.
const GRAMMARS: Record<NlpLanguage, () => Promise<{ default: unknown }>> = {
	nlp: () => import("./grammars/nlp.tmLanguage.json"),
	seq: () => import("./grammars/seq.tmLanguage.json"),
	kb: () => import("./grammars/kb.tmLanguage.json"),
	kbb: () => import("./grammars/kbb.tmLanguage.json"),
	dict: () => import("./grammars/dict.tmLanguage.json"),
	tree: () => import("./grammars/tree.tmLanguage.json"),
	txxt: () => import("./grammars/txxt.tmLanguage.json"),
};

// A theme with the extension's rules added. They name scopes deeper than anything a stock
// theme matches, so they win wherever they apply. Shiki's theme modules are frozen: copy.
function withNlpColors(theme: ThemeRegistration, rules: TokenRule[]): ThemeRegistration {
	return { ...theme, tokenColors: [...(theme.tokenColors ?? []), ...rules] };
}

let loading: Promise<HighlighterCore> | null = null;

// The page's highlighter, with every NLP++ grammar and both themes.
export function nlpHighlighter(): Promise<HighlighterCore> {
	loading ??= (async () => {
		const [core, engine, light, dark, ...grammars] = await Promise.all([
			import("@shikijs/core"),
			import("@shikijs/engine-javascript"),
			import("@shikijs/themes/light-plus"),
			import("@shikijs/themes/dark-plus"),
			...NLP_LANGUAGES.map((id) => GRAMMARS[id]()),
		]);
		return core.createHighlighterCore({
			themes: [withNlpColors(light.default, LIGHT_RULES), withNlpColors(dark.default, DARK_RULES)],
			langs: grammars.map((g, i) => ({ ...(g.default as object), name: NLP_LANGUAGES[i] }) as LanguageRegistration),
			engine: engine.createJavaScriptRegexEngine(),
		});
	})().catch((err) => {
		loading = null; // a failed load may succeed next time
		throw err;
	});
	return loading;
}

// The text as lines of tokens, each with its light and dark colour; null when it is not
// NLP++ or too long to colour.
export async function nlpTokens(text: string, lang: NlpLanguage | null): Promise<ThemedToken[][] | null> {
	if (!lang || !text || text.length > MAX_HIGHLIGHT_CHARS) return null;
	const highlighter = await nlpHighlighter();
	return highlighter.codeToTokens(text, { lang, themes: THEMES, defaultColor: false }).tokens;
}
