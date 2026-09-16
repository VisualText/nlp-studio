// What a run wrote, listed as the NLP++ extension's OUTPUT FILES view lists it: the files
// in output/, and the parse trees -- final.tree, and with debugging on, the tree after
// each pass.
//
// PURE: no DOM.

import { type AnalyzerFile, fileSize } from "./files.js";

// A parse tree a run kept.
export interface TreeFile {
	name: string;               // final.tree, or ana001.tree ... written after each pass
	pass: number | null;        // the pass it was written after; null for final.tree
	passName?: string | null;   // that pass's name, when the host knows it
	bytes?: number;
}

// Output files by name, as the extension sorts a folder.
export function outputOrder(files: Iterable<string | AnalyzerFile>): AnalyzerFile[] {
	return [...files].map((f) => (typeof f === "string" ? { path: f } : f))
		.sort((a, b) => a.path.localeCompare(b.path));
}

// The final tree first, then the tree after each pass, in pass order.
export function treeOrder<T extends Pick<TreeFile, "pass">>(trees: Iterable<T>): T[] {
	return [...trees].sort((a, b) => (a.pass ?? -1) - (b.pass ?? -1));
}

// "final", or the pass it was written after: "3 greeting".
export function treeLabel(tree: Pick<TreeFile, "pass" | "passName">): string {
	return tree.pass === null ? "final" : `${tree.pass} ${tree.passName ?? ""}`.trim();
}

// What the tree is, in a sentence: "final parse tree", "parse tree after pass 3 (greeting)".
export function treeTitle(tree: Pick<TreeFile, "pass" | "passName">): string {
	return tree.pass === null
		? "final parse tree"
		: `parse tree after pass ${tree.pass}${tree.passName ? ` (${tree.passName})` : ""}`;
}

// The line under a tree's name: when it was written, and its size when known.
export function treeNote(tree: Pick<TreeFile, "pass" | "bytes">): string {
	const when = tree.pass === null ? "after the last pass" : `after pass ${tree.pass}`;
	const size = fileSize(tree.bytes);
	return size ? `${when} · ${size}` : when;
}
