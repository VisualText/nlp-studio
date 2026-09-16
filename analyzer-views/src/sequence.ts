// spec/analyzer.seq as passes, the way the engine runs them and the NLP++ extension for
// VS Code lists them (vscode-nlp sequence.ts and sequenceView.ts).
//
// One pass per line: `<kind><TAB><name><TAB># comment`, e.g. `nlp	kbinit	# the skeleton`.
//
//   * a leading "/" switches a pass off: it is listed, greyed, and the engine skips it
//   * `folder` and `stub` open a group that `end <same name>` closes; the passes inside
//     carry the group's name in `folder`, and `end` lines are not passes
//   * a pass with no rule file (the tokenizer, `dicttokz nil`) has file null; otherwise
//     `file` is spec/<name>.nlp, or the older spec/<name>.pat, when the analyzer has it
//
// PURE: no DOM, so a server or a test can use it as well as a page.

export interface Pass {
	n: number | null;       // the engine's pass number; null for a folder or stub, which take none
	kind: string;           // nlp, pat, rec, tokenize, dicttokz, folder, stub, ... as written
	name: string;
	active: boolean;        // false when the line starts with "/"
	comment: string;        // the line's comment, without its "#"
	file: string | null;    // spec/<name>.nlp or .pat when the analyzer has it
	folder: string | null;  // the folder or stub this pass sits in, if any
}

// Kinds that open a group closed by `end <name>`, and take no pass number.
export const GROUP_KINDS: readonly string[] = ["folder", "stub"];

export const SEQUENCE_FILE = "spec/analyzer.seq";

const isGroup = (kind: string) => GROUP_KINDS.includes(kind.toLowerCase());

// Numbering follows the engine, because a run reports problems and parse-tree nodes by
// pass number: a switched-off pass keeps its number (the engine counts it), and a folder
// or stub has none. Measured on NLPPlus 2.2.37.
export function passes(seq: string, files: Iterable<string>): Pass[] {
	const have = new Set(files);
	const out: Pass[] = [];
	let n = 0;
	let folder: string | null = null;
	for (const raw of seq.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#") || line.startsWith("/*")) continue;
		const active = !line.startsWith("/");
		const [body, ...rest] = line.replace(/^\/+/, "").split("#");
		const [kind = "", name = ""] = body.trim().split(/\s+/);
		if (!kind) continue;
		if (kind.toLowerCase() === "end") {
			if (name === folder) folder = null;
			continue;
		}
		const group = isGroup(kind);
		const file = group ? null : [`spec/${name}.nlp`, `spec/${name}.pat`].find((f) => have.has(f)) ?? null;
		out.push({ n: group ? null : ++n, kind, name, active, comment: rest.join("#").trim(), file, folder });
		if (group) folder = name;
	}
	return out;
}

// The comment with its markers stripped, or "" when it says nothing. "# comment" is what
// the extension writes on a new pass, so it counts as nothing (sequence.ts commentTooltip).
export function passComment(comment: string | null | undefined): string {
	let text = String(comment ?? "").trim();
	if (text.startsWith("/*") && text.endsWith("*/")) text = text.slice(2, -2);
	text = text.replace(/^[#/*\s]+/, "").trim();
	return text.toLowerCase() === "comment" ? "" : text;
}

// The mouse-over for a pass, as the extension's: its comment when it says something,
// else the file it runs, else what kind of pass it is.
export function passTooltip(pass: Pick<Pass, "comment" | "file" | "kind">): string {
	return passComment(pass.comment) || pass.file || pass.kind || "";
}

// The name a pass is listed under, as the extension's sequence view: a rule pass or a
// group by its name, a built-in pass (tokenize nil) by what it does.
export function passLabel(pass: Pick<Pass, "file" | "kind" | "name">): string {
	return pass.file || isGroup(pass.kind) ? pass.name : pass.kind;
}
