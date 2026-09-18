// Which of an analyzer's files travel to a page, and how they are copied.
//
// Shared by copy-samples.mjs (the studio's own samples and the templates) and
// copy-analyzers.mjs (VisualText/analyzers, for the try page), so the two cannot
// drift on what an analyzer is or what goes out with it.
//
// PURE apart from fs: no network, no process state.

import fs from "node:fs";
import path from "node:path";

// Only the analyzer's own material. An engine run leaves output/, tmp/ and a
// <pass>_log/ behind; none of that describes the analyzer, and output/ would be
// read back as if the page's own run had written it.
export const TRAVELS = ["spec", "kb", "input"];

// The run server refuses a request over 8 MB of files (nlp_run.MAX_FILES_BYTES),
// so anything larger could be listed but never run.
export const MAX_FILE_BYTES = 1_000_000;

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// An analyzer is any folder holding spec/analyzer.seq.
export const isAnalyzer = (dir) => fs.existsSync(path.join(dir, "spec", "analyzer.seq"));

export function filesUnder(dir, rel = "") {
	const found = [];
	for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
		const r = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (entry.name.endsWith("_log") || entry.name === "output" || entry.name === "tmp") continue;
			found.push(...filesUnder(dir, r));
		} else if (fs.statSync(path.join(dir, r)).size <= MAX_FILE_BYTES) {
			found.push(r);
		}
	}
	return found;
}

// Copy one analyzer's files under <out>/<slug>/, and describe it for the index.
// Returns null for a folder that is not an analyzer.
export function copyAnalyzer(from, title, origin, out, extra = {}) {
	if (!isAnalyzer(from)) return null;
	const name = slug(title);
	const files = TRAVELS.filter((d) => fs.existsSync(path.join(from, d)))
		.flatMap((d) => filesUnder(from, d))
		.sort();
	let bytes = 0;
	for (const f of files) {
		const dest = path.join(out, name, f);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(from, f), dest);
		bytes += fs.statSync(path.join(from, f)).size;
	}
	return { name, title, origin, files, bytes, ...extra };
}

// The file whose text the page starts with. Analyzers here name it input/text.txt;
// where they do not, take the first, so the choice is the same on every build.
export function defaultInput(files) {
	return files.find((f) => f === "input/text.txt") ?? files.find((f) => f.startsWith("input/")) ?? null;
}
