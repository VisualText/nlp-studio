// "Try an analyzer": pick one of VisualText's analyzers, run it on some text, and see
// what it did -- the passes, the knowledge base, what the run wrote, the parse trees,
// and for a -DEV run, each pass's own tree and what its rules matched.
//
// The analyzers are baked in at build time by scripts/copy-analyzers.mjs, from a pinned
// commit of VisualText/analyzers. The visitor edits the text, never the NLP++, so the
// only code the engine runs is ours: see deploy/INSTALL.md on why that matters.
//
// The lists are @visualtext/analyzer-views, the same elements the NLP++ extension's
// views are built from, so a pass is numbered and a knowledge base is filtered here
// exactly as they are in VS Code.

import "@visualtext/analyzer-views/style.css";
import "@visualtext/analyzer-views";
import type { NlpCode, NlpKnowledgeBase, NlpLog, NlpOutput, NlpSequence, NlpTrees, NlpValues, OpenDetail }
	from "@visualtext/analyzer-views";
import { kbDescription, ruleMatches, shownInKnowledgeBase } from "@visualtext/analyzer-views/rules";

import { fetchTree, outputFiles, runAnalyzer, serverHealth, type RunResult } from "../run/api";
import { inputTexts } from "./inputs";
import { passTrees, resultTone, valuesOutput, viewTrees } from "./result";
import "./try.css";

// The page is served at <site>/try/, so its analyzers sit beside it and the run server
// is one level up, shared with the studio. Both are relative: the built site works from
// any folder or host (vite.config.ts sets base "./").
const ANALYZERS = "analyzers";
const API = "../api";

// What scripts/copy-analyzers.mjs wrote. Not AnalyzerEntry from ../analyzers: that one's
// `source` means "fetch it from GitHub through the studio server", and these are static.
interface TryEntry {
	name: string;
	title: string;
	shows: string;
	files: string[];
	bytes: number;
	input: string | null;
	pinned: { repo: string; folder: string; commit: string | null; release: string | null };
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
	analyzer: byId<HTMLSelectElement>("analyzer"),
	run: byId<HTMLButtonElement>("run"),
	debug: byId<HTMLInputElement>("debug"),
	status: byId<HTMLElement>("status"),
	theme: byId<HTMLButtonElement>("theme"),
	shows: byId<HTMLElement>("shows"),
	pinned: byId<HTMLElement>("pinned"),
	sequence: byId<NlpSequence>("sequence"),
	kb: byId<NlpKnowledgeBase>("kb"),
	path: byId<HTMLElement>("path"),
	pathNote: byId<HTMLElement>("path-note"),
	code: byId<NlpCode>("code"),
	text: byId<HTMLTextAreaElement>("text"),
	inputPick: byId<HTMLSelectElement>("input-pick"),
	resetText: byId<HTMLButtonElement>("reset-text"),
	message: byId<HTMLElement>("result-message"),
	values: byId<NlpValues>("values"),
	output: byId<NlpOutput>("output"),
	trees: byId<NlpTrees>("trees"),
	log: byId<NlpLog>("log"),
};

// What is open now. `ranText` is kept apart from the box on purpose: the matches of a
// pass are marked over the text that actually ran, not over what has been typed since.
const state = {
	entry: null as TryEntry | null,
	files: new Map<string, string>(),   // the analyzer's own files, by path
	result: null as RunResult | null,
	ranText: "",
	input: null as string | null,       // which of the analyzer's texts is in the box
	busy: false,
};

// ---- showing one file -------------------------------------------------------------

function show(path: string, text: string, note = "", language?: string): void {
	els.path.textContent = path;
	els.pathNote.textContent = note;
	if (language) els.code.setAttribute("language", language);
	else els.code.removeAttribute("language");
	els.code.path = language ? null : path;
	els.code.text = text;
	els.code.line = null;
}

function showAnalyzerFile(path: string, line?: number): void {
	const text = state.files.get(path);
	if (text === undefined) return;
	show(path, text);
	els.sequence.selected = path;
	els.kb.selected = path;
	if (line) els.code.line = line;
}

function showRunFile(name: string): void {
	const text = state.result?.output?.[name];
	if (text === undefined) return;
	show(`output/${name}`, text, "written by this run");
	els.sequence.selected = null;
	els.kb.selected = null;
}

// A tree is not sent with the result -- they get large -- so it is fetched when opened.
async function withTree(name: string, then: (tree: string) => void): Promise<void> {
	const run = state.result?.trees?.run;
	if (!run) return;
	show(name, "Fetching…", "");
	try {
		then(await fetchTree(run, name, API));
	} catch (error) {
		show(name, "", "", undefined);
		els.message.textContent = `${name}: ${error instanceof Error ? error.message : String(error)}`;
		els.message.className = "result-message bad";
	}
}

// ---- loading an analyzer ----------------------------------------------------------

async function loadIndex(): Promise<TryEntry[]> {
	const res = await fetch(`${ANALYZERS}/index.json`, { cache: "no-store" });
	if (!res.ok) throw new Error(`analyzers/index.json: HTTP ${res.status} -- run npm run analyzers`);
	return ((await res.json()) as { analyzers: TryEntry[] }).analyzers;
}

async function loadFiles(entry: TryEntry): Promise<Map<string, string>> {
	const texts = await Promise.all(entry.files.map(async (path) => {
		const url = `${ANALYZERS}/${entry.name}/${path.split("/").map(encodeURIComponent).join("/")}`;
		const res = await fetch(url);
		return [path, res.ok ? await res.text() : ""] as const;
	}));
	return new Map(texts);
}

function clearResults(): void {
	state.result = null;
	state.ranText = "";
	els.message.textContent = "";
	els.message.className = "result-message";
	els.values.output = null;
	els.output.files = [];
	els.trees.trees = [];
	els.trees.skipped = [];
	els.sequence.trees = [];
	els.log.problems = [];
	els.log.lines = [];
}

async function openAnalyzer(entry: TryEntry): Promise<void> {
	state.entry = entry;
	state.files = await loadFiles(entry);
	clearResults();

	const paths = [...state.files.keys()];
	const encoder = new TextEncoder();
	els.sequence.files = paths;
	els.sequence.sequence = state.files.get("spec/analyzer.seq") ?? "";
	// Each file's opening comment is its mouse-over, as in the extension; kbDescription()
	// reads only the top of it. Bytes, not characters: a dictionary of accented words is
	// longer than its length.
	els.kb.files = paths.filter(shownInKnowledgeBase).map((path) => {
		const text = state.files.get(path) ?? "";
		return { path, bytes: encoder.encode(text).length, description: kbDescription(text) };
	});

	els.shows.textContent = entry.shows;
	// Say which copy of the analyzer this is: a release tag when it came from the
	// bundle, a commit when it came from a checkout.
	const { repo, folder, commit, release } = entry.pinned;
	const at = release ?? (commit ? commit.slice(0, 8) : null);
	els.pinned.textContent = at ? `${repo}/${folder} at ${at}` : `${repo}/${folder}`;

	// Its texts: a picker when there is more than one, none when there is a single text.
	const { texts, start } = inputTexts(paths, entry.input);
	els.inputPick.replaceChildren(...texts.map((t) => {
		const option = document.createElement("option");
		option.value = t.path;
		option.textContent = t.label;
		return option;
	}));
	els.inputPick.hidden = texts.length < 2;
	showInput(start);
	showAnalyzerFile("spec/analyzer.seq");
}

// One of the analyzer's texts into the box. Choosing another replaces what was typed:
// the box holds one text, and Reset puts the chosen one back.
function showInput(path: string | null): void {
	state.input = path;
	els.text.value = path ? state.files.get(path) ?? "" : "";
	if (path) els.inputPick.value = path;
	els.resetText.disabled = !path;
}

// ---- running ----------------------------------------------------------------------

function showResult(result: RunResult): void {
	state.result = result;

	const ms = typeof result.ms === "number" ? ` (${result.ms} ms)` : "";
	els.message.textContent = result.status === "ok" ? `${result.message}${ms}` : result.message;
	const tone = resultTone(result.status);
	els.message.className = tone ? `result-message ${tone}` : "result-message";

	els.output.files = outputFiles(result);
	const values = valuesOutput(result);
	els.values.output = values.output;
	// An output.json the analyzer wrote but no one can parse is worth saying out loud.
	if (values.error) {
		els.message.textContent = `${els.message.textContent} ${values.error}`.trim();
		els.message.className = "result-message warn";
	}

	const trees = viewTrees(result);
	els.trees.trees = trees;
	els.trees.skipped = result.trees?.skipped ?? [];
	els.sequence.trees = passTrees(trees);

	els.log.problems = result.problems ?? [];
	els.log.lines = result.log ?? [];
}

async function run(): Promise<void> {
	if (state.busy || !state.entry) return;
	state.busy = true;
	els.run.disabled = true;
	els.run.classList.add("running");
	els.status.textContent = "Running…";
	els.status.className = "muted grow";

	const text = els.text.value;
	const files = Object.fromEntries(state.files);
	try {
		const result = await runAnalyzer(files, text, { develop: els.debug.checked }, API);
		state.ranText = text;          // what the matches will be marked over
		showResult(result);
		els.status.textContent = state.entry.title;
	} finally {
		state.busy = false;
		els.run.disabled = false;
		els.run.classList.remove("running");
	}
}

// ---- wiring -----------------------------------------------------------------------

function wire(): void {
	// A pass or a dictionary.
	for (const list of [els.sequence, els.kb]) {
		list.addEventListener("nlp-open", (e) => {
			showAnalyzerFile((e as CustomEvent<OpenDetail>).detail.path);
		});
	}

	// A pass's own tree, and the text with what its rules matched -- the two icons a
	// -DEV run puts on every pass, as the extension's sequence view does.
	els.sequence.addEventListener("nlp-open-tree", (e) => {
		const { path } = (e as CustomEvent<OpenDetail>).detail;
		void withTree(path, (tree) => show(path, tree, "parse tree after this pass", "tree"));
	});
	els.sequence.addEventListener("nlp-open-matches", (e) => {
		const { path, pass } = (e as CustomEvent<OpenDetail>).detail;
		void withTree(path, (tree) => {
			// Marked over the text that ran, not over the box, which may have been edited.
			const marked = ruleMatches(tree, state.ranText);
			show(`pass ${pass ?? "?"} matches`, marked, "what this pass's rules matched", "txxt");
		});
	});

	// What the run wrote, and the trees it kept.
	els.output.addEventListener("nlp-open", (e) => {
		showRunFile((e as CustomEvent<OpenDetail>).detail.path);
	});
	els.trees.addEventListener("nlp-open", (e) => {
		const { path } = (e as CustomEvent<OpenDetail>).detail;
		void withTree(path, (tree) => show(path, tree, "", "tree"));
	});

	// A problem opens its pass at its line.
	els.log.addEventListener("nlp-open", (e) => {
		const { path, line } = (e as CustomEvent<OpenDetail>).detail;
		if (path) showAnalyzerFile(path, line);
	});

	els.analyzer.addEventListener("change", () => {
		const entry = entries.find((a) => a.name === els.analyzer.value);
		if (entry) void openAnalyzer(entry);
	});
	els.run.addEventListener("click", () => void run());
	els.inputPick.addEventListener("change", () => showInput(els.inputPick.value));
	els.resetText.addEventListener("click", () => {
		if (state.input) els.text.value = state.files.get(state.input) ?? "";
	});
	document.addEventListener("keydown", (e) => {
		if (e.key === "F5" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); void run(); }
	});
	els.theme.addEventListener("click", () => {
		const dark = matchMedia("(prefers-color-scheme: dark)").matches;
		const now = document.documentElement.dataset.theme ?? (dark ? "dark" : "light");
		document.documentElement.dataset.theme = now === "dark" ? "light" : "dark";
	});
}

// ---- start ------------------------------------------------------------------------

let entries: TryEntry[] = [];

async function start(): Promise<void> {
	wire();
	try {
		entries = await loadIndex();
	} catch (error) {
		els.status.textContent = error instanceof Error ? error.message : String(error);
		els.status.className = "grow bad";
		return;
	}
	if (entries.length === 0) {
		els.status.textContent = "No analyzers were built into this page.";
		els.status.className = "grow bad";
		return;
	}

	els.analyzer.replaceChildren(...entries.map((a) => {
		const option = document.createElement("option");
		option.value = a.name;
		option.textContent = a.title;
		return option;
	}));
	await openAnalyzer(entries[0]);

	// Say plainly when there is no run server: the page still shows every analyzer, it
	// just cannot run one, and a page that says nothing here is the bug we keep refixing.
	const health = await serverHealth(API);
	if (health) {
		els.run.disabled = false;
		els.status.textContent = `${entries[0].title} · engine ${health.engine ?? "?"}`;
	} else {
		els.status.textContent = "No run server answered, so nothing can be run here. "
			+ "The analyzers below can still be read.";
		els.status.className = "grow bad";
	}
}

void start();
