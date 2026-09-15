// Put the sample analyzers where the page can fetch them, and list them.
//
//   node scripts/copy-samples.mjs          (runs before `npm run dev` and `npm run build`)
//
// Two sources:
//
//   samples/            analyzers written for NLP Studio, committed here
//   analyzer-templates  VisualText/analyzer-templates, from a sibling checkout
//                       (../../analyzer-templates, or ANALYZER_TEMPLATES) when
//                       there is one
//
// The templates are copied at build time and never committed: that repository
// carries no license file, and this one is public. Without the checkout the
// studio still opens, with its own samples.
//
// Output: public/analyzers/<slug>/... and public/analyzers/index.json. Only
// spec/, kb/ and input/ travel, never output/, tmp/ or an engine run's *_log/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(studio, "public", "analyzers");
const templates = process.env.ANALYZER_TEMPLATES
	|| path.resolve(studio, "..", "..", "analyzer-templates");

// Small enough to load in a tab, and each shows something different.
const PICKED_TEMPLATES = [
	"Telephone Numbers", "Email Addresses", "Date and Times", "Knowledge Base", "Bare Minimum",
];
const TRAVELS = ["spec", "kb", "input"];
const MAX_FILE_BYTES = 1_000_000;

export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function filesUnder(dir, rel = "") {
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

function copyAnalyzer(from, title, origin) {
	if (!fs.existsSync(path.join(from, "spec", "analyzer.seq"))) return null;
	const name = slug(title);
	const files = TRAVELS.filter((d) => fs.existsSync(path.join(from, d)))
		.flatMap((d) => filesUnder(from, d))
		.sort();
	for (const f of files) {
		const dest = path.join(out, name, f);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(from, f), dest);
	}
	return { name, title, origin, files };
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const analyzers = [];
const samples = path.join(studio, "samples");
for (const entry of fs.readdirSync(samples, { withFileTypes: true })) {
	if (entry.isDirectory()) {
		const a = copyAnalyzer(path.join(samples, entry.name), entry.name, "sample");
		if (a) analyzers.push(a);
	}
}
if (fs.existsSync(templates)) {
	for (const title of PICKED_TEMPLATES) {
		const a = copyAnalyzer(path.join(templates, title), title, "template");
		if (a) analyzers.push(a);
	}
} else {
	console.log(`copy-samples: no analyzer-templates at ${templates}; studio samples only`);
}

fs.writeFileSync(path.join(out, "index.json"), JSON.stringify({ analyzers }, null, "\t") + "\n");
console.log(`copy-samples: ${analyzers.length} analyzers, `
	+ `${analyzers.reduce((n, a) => n + a.files.length, 0)} files -> public/analyzers/`);
