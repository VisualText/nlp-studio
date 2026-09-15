// The engine's final parse tree (output/final.tree), as a run returns it.
//
// One node a line, indented three spaces a level, in the format of the engine's
// Pn::print (nlp-engine lite/pn.cpp):
//
//   <indent><name> [start,end,ustart,uend,pass,ruleline,type<,flags>]
//
// Ported from vscode-nlp src/trace/treeParse.ts (MIT, Amnon Meyers and David de
// Hilster), which explains why flags are read by name and not by position: the
// engine writes a flag only when it is set.
//
// OFFSETS. start/end count UTF-8 bytes and ustart/uend count code points, both
// inclusive. JavaScript strings count UTF-16 units, which differ from code points
// for everything past the Basic Multilingual Plane -- an emoji is one code point
// and two units -- so a span goes through utf16Offsets before it reaches the editor.

export interface TreeNode {
	name: string;
	start: number;      // UTF-8 bytes, inclusive
	end: number;
	ustart: number;     // code points, inclusive
	uend: number;
	pass: number;       // the pass that built this node; 0 for a token
	line: number;       // the line in that pass's file of the rule that built it
	type: string;       // node, alpha, num, punct, white, ...
	fired: boolean;     // a rule matched here
	built: boolean;     // a rule made this node
	depth: number;
	children: TreeNode[];
}

// Name is non-greedy, so the token for an open bracket in the text ("[ [3,3,...]")
// keeps "[" as its name.
const LINE = /^(\s*)(.*?)\s+\[([^\]]*)\]\s*$/;
const INDENT = 3;

export function parseTreeLine(line: string): TreeNode | undefined {
	const m = LINE.exec(line);
	if (!m) return undefined;
	const [, indent, rawName, fields] = m;
	// Attributes, when a dump has them, start at the first "(".
	const cut = fields.indexOf("(");
	const parts = (cut >= 0 ? fields.slice(0, cut) : fields).split(",").map((p) => p.trim()).filter(Boolean);
	if (parts.length < 7) return undefined;
	const num = (s: string) => {
		const n = parseInt(s, 10);
		return Number.isFinite(n) ? n : 0;
	};
	const flags = new Set(parts.slice(7));
	return {
		name: rawName.replace(/ r_to_l$/, "").trim(),
		start: num(parts[0]),
		end: num(parts[1]),
		ustart: num(parts[2]),
		uend: num(parts[3]),
		pass: num(parts[4]),
		line: num(parts[5]),
		type: parts[6],
		fired: flags.has("fired"),
		built: flags.has("blt"),
		depth: Math.floor(indent.length / INDENT),
		children: [],
	};
}

// The whole dump as a tree. A malformed or cut-off dump still gives what it has.
export function parseTree(text: string): TreeNode | undefined {
	let root: TreeNode | undefined;
	const stack: TreeNode[] = [];
	for (const line of text.split(/\r?\n/)) {
		const node = parseTreeLine(line);
		if (!node) continue;
		if (!root || node.depth === 0 || !stack.length) {
			if (root) continue; // a second root: not something the engine writes
			root = node;
			stack.length = 0;
			stack[0] = node;
			continue;
		}
		const parentDepth = Math.min(node.depth - 1, stack.length - 1);
		stack[parentDepth].children.push(node);
		stack.length = parentDepth + 1;
		stack[parentDepth + 1] = node;
	}
	return root;
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

// The node's text as [from, to) in UTF-16 units, or undefined if it lies outside the text.
export function spanOf(node: TreeNode, offsets: number[]): [number, number] | undefined {
	const last = offsets.length - 1;
	if (node.ustart < 0 || node.ustart > last || node.uend < node.ustart) return undefined;
	return [offsets[node.ustart], offsets[Math.min(node.uend + 1, last)]];
}

// The engine escapes whitespace tokens; show them as something visible.
const SHOWN: Record<string, string> = { "\\_": "␣", "\\n": "⏎", "\\t": "⇥", "\\r": "␍" };

export function displayName(name: string): string {
	return SHOWN[name] ?? name;
}
