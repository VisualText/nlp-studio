// Put VisualText's own analyzers where the try page can fetch them, and list them.
//
//   node scripts/copy-analyzers.mjs        (runs before `npm run dev` and `npm run build`)
//
// Source: VisualText/analyzers, at ../../analyzers or VISUALTEXT_ANALYZERS. Either
//
//   the analyzers.zip of one of its releases, unpacked -- what the Dockerfile uses, and
//   what VisualText itself downloads as its example analyzers, so the page shows exactly
//   the set a VisualText user has; VISUALTEXT_ANALYZERS_TAG names the release, or
//
//   a git checkout, for working on this locally. Three of the five entries are
//   submodules, so clone with --recurse-submodules or the tutorials and the NLPFix
//   analyzers are not there.
//
// The zip holds the five bundled entries only, so anything outside them (business/)
// cannot be picked here.
//
// Output: public/try/analyzers/<slug>/... and public/try/analyzers/index.json, which
// the try page fetches as static files. Nothing is read from GitHub at run time and
// nothing the visitor types becomes NLP++: the grammars that run are these, fixed at
// build time, which is what lets the page be opened up without a per-run sandbox.
// What travels is scripts/analyzer-files.mjs, shared with copy-samples.mjs.
//
// Without the checkout the try page still builds and says it has no analyzers.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyAnalyzer, defaultInput } from "./analyzer-files.mjs";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(studio, "public", "try", "analyzers");
const repo = process.env.VISUALTEXT_ANALYZERS || path.resolve(studio, "..", "..", "analyzers");

// Eight of the twenty in the bundle, each showing something the others do not, and each
// confirmed to run through the run server. What is left out, and why:
//
//   parse-en-us              refused: it calls interactive(), which nlp_run.BLOCKED
//                            lists with the desktop app's popups. 4.6 MB besides.
//   nlp-tutorials/tutorial-01  26 MB of engine .kb dumps, over the run server's 8 MB
//                            limit, for a sequence of one pass.
//   the remaining tutorials  they run, but each overlaps one of the eight below.
const PICKED = [
	["corporate", "Corporate",
		"Companies, money and events, with pronouns resolved back to what they refer to."],
	["nlp-tutorials/tutorial-07", "Regions",
		"Where NLP++ code, functions and rules live in a pass — and what a code-only pass matches."],
	["nlpfix-analyzers/date-time", "Dates and Times",
		"Dates and times in many formats, where a regular expression needs rewriting for each."],
	["nlpfix-analyzers/formatting", "Formatting",
		"Recovers headings, lists and tables from text that lost its formatting."],
	["nlpfix-analyzers/nlp", "Entities",
		"Gathers what a text says about each person or thing into one record."],
	["nlp-tutorials/tutorial-02", "Variables",
		"The five NLP++ variables — N, S, X, G and L — on a short résumé."],
	["nlp-tutorials/tutorial-08", "Pronouns",
		"Builds a knowledge base from the text as it reads, then resolves pronouns with it."],
	["nlp-tutorials/tutorial-15", "Ambiguity",
		"Choosing between readings of the same words, with a dictionary and a .kbb file."],
];

// The release the analyzers came from, when the build was given one.
const release = process.env.VISUALTEXT_ANALYZERS_TAG || null;

// The commit each analyzer's files came from, so the page can say what it is showing.
// A submodule is its own repository, so ask in the analyzer's own folder. An unpacked
// release zip is not a checkout and has none; there the release tag says what it is.
function commitOf(dir) {
	try {
		// The zip keeps the submodules' .git pointer files, so git is asked and complains
		// on stderr before failing; the answer is the release tag, not a commit.
		return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const analyzers = [];
if (fs.existsSync(repo)) {
	for (const [folder, title, shows] of PICKED) {
		const from = path.join(repo, folder);
		// "pinned", not "source": in analyzers.ts a source means "fetch this through the
		// studio server from GitHub", and these are static files.
		const a = copyAnalyzer(from, title, "analyzer", out, {
			shows,
			pinned: { repo: "VisualText/analyzers", folder, commit: commitOf(from), release },
		});
		if (!a) {
			console.warn(`copy-analyzers: no spec/analyzer.seq at ${folder} `
				+ "-- clone with --recurse-submodules");
			continue;
		}
		a.input = defaultInput(a.files);
		if (!a.input) console.warn(`copy-analyzers: ${folder} has no input file; the page starts empty`);
		analyzers.push(a);
	}
} else {
	console.log(`copy-analyzers: no analyzers checkout at ${repo}; the try page will have none`);
}

fs.writeFileSync(path.join(out, "index.json"), JSON.stringify({ analyzers }, null, "\t") + "\n");
console.log(`copy-analyzers: ${analyzers.length} analyzers, `
	+ `${analyzers.reduce((n, a) => n + a.files.length, 0)} files, `
	+ `${(analyzers.reduce((n, a) => n + a.bytes, 0) / 1024 / 1024).toFixed(2)} MB -> public/try/analyzers/`);
