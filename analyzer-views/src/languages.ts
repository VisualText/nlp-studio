// Which NLP++ grammar reads a file, by its name. PURE: no DOM.

// The languages the grammars in ./grammars define: rule files, pass sequences, the three
// knowledge-base formats, parse trees, and .txxt.
export const NLP_LANGUAGES = ["nlp", "seq", "kb", "kbb", "dict", "tree", "txxt"] as const;
export type NlpLanguage = (typeof NLP_LANGUAGES)[number];

// The grammar for a file, or null for a file that is not NLP++. .pat is the older
// extension for a rule file and reads as one.
export function langFor(path: string | null | undefined): NlpLanguage | null {
	const name = String(path ?? "").toLowerCase().split("/").pop() ?? "";
	const ext = name.includes(".") ? name.split(".").pop()! : "";
	if (ext === "pat") return "nlp";
	return (NLP_LANGUAGES as readonly string[]).includes(ext) ? ext as NlpLanguage : null;
}
