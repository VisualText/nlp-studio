// What a pass's rules matched, read off the tree it wrote: the input text with every
// match marked, as the NLP++ extension for VS Code's "Display Matched Rules" writes it
// (vscode-nlp treeFile.ts parseFireds and writeFiredText, the .txxt file).
//
// The engine writes no such file. It writes a tree after every pass when it runs with
// -DEV -- output/ana003.tree is the tree as pass 3 left it -- and every node that a rule
// matched carries the "fired" flag, with "blt" on the ones a rule built. The marked text
// is those spans put back over the input:
//
//     I live in <<<San Diego>>>, in (((California))).
//
//   <<< >>>   a rule built a node here
//   ((( )))   a rule matched here without building one
//
// which is the .txxt grammar's own markers, so the result colours as NLP++ colours a
// rule-match file.
//
// OUTERMOST WINS. The dump is depth-first, parents before children, so a match inside one
// already marked is skipped rather than nested -- as the extension does it. Nesting would
// need markers the .txxt grammar does not have.
//
// OFFSETS. A node's ustart/uend count code points, inclusive; JavaScript counts UTF-16
// units, which differ for everything past the Basic Multilingual Plane. They go through
// utf16Offsets, so a match after an emoji still covers the words it matched.
//
// PURE: no DOM, so a server or a test can use it as well as a page.

// One rule match, as [from, to) in UTF-16 units of the input text.
export interface RuleMatch {
	from: number;
	to: number;
	built: boolean;   // a rule built a node here, rather than only matching
}

// <indent><name> [start,end,ustart,uend,pass,ruleline,type<,flags>]. The name is
// non-greedy, so the token for an open bracket in the text keeps "[" as its name.
const LINE = /^(\s*)(.*?)\s+\[([^\]]*)\]\s*$/;

export interface MatchOptions {
	// Only the matches that built a node -- the extension's "Display Built Only".
	builtOnly?: boolean;
}

// offsets[c] is where code point c starts in UTF-16 units; the last entry is the length.
export function utf16Offsets(text: string): number[] {
	const out: number[] = [];
	let unit = 0;
	for (const ch of text) {
		out.push(unit);
		unit += ch.length;
	}
	out.push(unit);
	return out;
}

// The matches in one pass's tree, over `text` -- the input exactly as it was run.
export function matchesIn(tree: string | null | undefined, text: string, options: MatchOptions = {}): RuleMatch[] {
	const offsets = utf16Offsets(text);
	const last = offsets.length - 1;
	const found: RuleMatch[] = [];
	let covered = -1;   // the last code point already inside a match
	for (const line of String(tree ?? "").split(/\r?\n/)) {
		const m = LINE.exec(line);
		if (!m) continue;
		const fields = m[3];
		const cut = fields.indexOf("(");   // attributes, when a dump has them
		const parts = (cut >= 0 ? fields.slice(0, cut) : fields).split(",").map((p) => p.trim()).filter(Boolean);
		if (parts.length < 7) continue;
		const flags = new Set(parts.slice(7));
		if (!flags.has("fired")) continue;
		const built = flags.has("blt");
		if (options.builtOnly && !built) continue;
		const ustart = Number.parseInt(parts[2], 10);
		const uend = Number.parseInt(parts[3], 10);
		if (!Number.isFinite(ustart) || !Number.isFinite(uend)) continue;
		if (uend <= covered || ustart < 0 || ustart > last || uend < ustart) continue;
		covered = uend;
		found.push({ from: offsets[ustart], to: offsets[Math.min(uend + 1, last)], built });
	}
	return found;
}

// The input text with the pass's matches marked: what the extension opens as
// output/ana003.txxt. Text the pass matched nothing in comes back unchanged.
export function ruleMatches(tree: string | null | undefined, text: string, options: MatchOptions = {}): string {
	let out = "";
	let at = 0;
	for (const match of matchesIn(tree, text, options)) {
		const [open, close] = match.built ? ["<<<", ">>>"] : ["(((", ")))"];
		out += text.slice(at, match.from) + open + text.slice(match.from, match.to) + close;
		at = match.to;
	}
	return out + text.slice(at);
}

// How many matches a pass made, for a line under its name: "3 matches, 2 built".
export function matchCount(matches: readonly RuleMatch[]): string {
	const built = matches.filter((m) => m.built).length;
	const n = `${matches.length} match${matches.length === 1 ? "" : "es"}`;
	return built ? `${n}, ${built} built` : n;
}
