// NLP Studio: an NLP++ analyzer in the browser, edited with the language's own tools.
//
//   highlight.ts   colour, from the VS Code extension's TextMate grammars
//   lsp/client.ts  hover, definition, references, completion, rename, formatting,
//                  quick fixes and problems, from the extension's language server
//                  running in a Web Worker
//   analyzers.ts   the analyzers to open, fetched as static files
//   run/           running one: its files go to the run server (server/app.py), and
//                  the output, parse tree and problems come back
//
// Edits stay in the tab; nothing is saved.
import "./styles.css";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { monaco } from "./monaco";
import { installHighlighting, THEMES } from "./highlight";
import { NlpLanguageClient, installLanguageFeatures } from "./lsp/client";
import { languageFor } from "./lsp/convert";
import { type AnalyzerEntry, type Pass, fileUri, loadFiles, loadIndex, passes, pathOf } from "./analyzers";
import { type RunResult, runAnalyzer, serverHealth } from "./run/api";
import { RunPanel } from "./run/panel";
import { selfTest } from "./selftest";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What the language server indexes across files.
const INDEXED = /\.(nlp|pat|kbb)$/i;
// The last run's problems, as markers kept apart from the language server's so
// each set can be replaced without touching the other.
export const RUN_MARKERS = "nlp++ run";

function darkTheme(): boolean {
	const set = document.documentElement.dataset.theme;
	return set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export class Studio {
	analyzers: AnalyzerEntry[] = [];
	current: AnalyzerEntry | undefined;
	currentPath: string | undefined;
	// The input a run reads: the input file opened last, or the analyzer's first.
	inputPath: string | undefined;
	passList: Pass[] = [];
	readonly editor: monaco.editor.IStandaloneCodeEditor;
	readonly panel: RunPanel;
	private readonly models = new Map<string, monaco.editor.ITextModel>();
	private running = false;

	constructor(readonly client: NlpLanguageClient) {
		this.editor = monaco.editor.create(byId("editor"), {
			automaticLayout: true,
			fontSize: 13,
			tabSize: 4,
			insertSpaces: false,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			theme: darkTheme() ? THEMES.dark : THEMES.light,
		});
		// Go to definition in another pass opens that pass in this editor.
		monaco.editor.registerEditorOpener({
			openCodeEditor: (_source, resource, selection) => {
				const path = this.current && pathOf(resource.toString(), this.current.name);
				if (!path || !this.models.has(path)) return false;
				this.openPath(path, selection);
				return true;
			},
		});
		monaco.editor.onDidChangeMarkers(() => this.showProblems());

		this.panel = new RunPanel(byId("results"), {
			open: (path, at) => this.openPath(path, at),
			selectInput: (path, from, to) => this.selectInput(path, from, to),
		});
		byId("run").addEventListener("click", () => void this.run());
		this.editor.addAction({
			id: "nlp.runAnalyzer",
			label: "Run Analyzer",
			keybindings: [monaco.KeyCode.F5],
			run: () => void this.run(),
		});
	}

	async openAnalyzer(name: string): Promise<void> {
		const entry = this.analyzers.find((a) => a.name === name);
		if (!entry) return;
		const texts = await loadFiles(entry);
		for (const model of this.models.values()) model.dispose();
		this.models.clear();
		this.current = entry;
		for (const [path, text] of texts) {
			const model = monaco.editor.createModel(text, languageFor(path), monaco.Uri.parse(fileUri(entry.name, path)));
			// A run's markers describe the text that ran; editing makes them stale.
			model.onDidChangeContent(() => {
				if (monaco.editor.getModelMarkers({ owner: RUN_MARKERS, resource: model.uri }).length) {
					monaco.editor.setModelMarkers(model, RUN_MARKERS, []);
				}
			});
			this.models.set(path, model);
		}
		await this.client.setFiles([...texts]
			.filter(([path]) => INDEXED.test(path))
			.map(([path, text]) => ({ uri: fileUri(entry.name, path), text })));
		this.passList = passes(texts.get("spec/analyzer.seq") ?? "", entry.files);
		this.inputPath = entry.files.find((f) => f.startsWith("input/"));
		this.panel.clear();
		this.renderFiles();
		this.showRunTarget();
		const first = this.passList.find((p) => p.file && p.active)?.file;
		this.openPath(first ?? "spec/analyzer.seq");
	}

	openPath(path: string, selection?: monaco.IRange | monaco.IPosition): void {
		const model = this.models.get(path);
		if (!model || !this.current) return;
		this.editor.setModel(model);
		this.client.open(model, path);
		this.currentPath = path;
		if (path.startsWith("input/")) {
			this.inputPath = path;
			this.showRunTarget();
		}
		byId("path").textContent = `${this.current.title} / ${path}`;
		for (const el of byId("files").querySelectorAll<HTMLElement>("[data-path]")) {
			el.classList.toggle("on", el.dataset.path === path);
		}
		if (selection) {
			const range = monaco.Range.isIRange(selection)
				? selection
				: monaco.Range.fromPositions(selection);
			this.editor.setSelection(range);
			this.editor.revealRangeInCenter(range);
		}
		this.editor.focus();
		this.showProblems();
	}

	// Select [from, to) -- UTF-16 offsets into the text as it was run -- in an input file.
	selectInput(path: string, from: number, to: number): void {
		const model = this.models.get(path);
		if (!model) return;
		this.openPath(path, monaco.Range.fromPositions(model.getPositionAt(from), model.getPositionAt(to)));
	}

	// Run the analyzer, as it stands in the editor, over the current input file.
	async run(): Promise<RunResult> {
		const analyzer = this.current;
		const inputPath = this.inputPath;
		const input = inputPath ? this.models.get(inputPath) : undefined;
		if (this.running) return { status: "busy", message: "A run is already going." };
		if (!analyzer || !inputPath || !input) return { status: "invalid", message: "This analyzer has no input file to run on." };

		this.running = true;
		this.showRunTarget();
		const status = byId("status");
		const before = status.textContent;
		status.textContent = `Running ${analyzer.title} on ${inputPath}…`;
		const files: Record<string, string> = {};
		for (const [path, model] of this.models) {
			if (!path.startsWith("input/")) files[path] = model.getValue();
		}
		const text = input.getValue();
		try {
			const result = await runAnalyzer(files, text);
			if (this.current === analyzer) {
				this.markRunProblems(result);
				this.panel.show(result, {
					text,
					inputPath,
					passFile: (n) => this.passList.find((p) => p.n === n)?.file ?? null,
				});
			}
			return result;
		} finally {
			this.running = false;
			status.textContent = before;
			this.showRunTarget();
		}
	}

	private markRunProblems(result: RunResult): void {
		for (const model of this.models.values()) monaco.editor.setModelMarkers(model, RUN_MARKERS, []);
		const byFile = new Map<monaco.editor.ITextModel, monaco.editor.IMarkerData[]>();
		for (const p of result.problems ?? []) {
			const model = p.file ? this.models.get(p.file) : undefined;
			if (!model || p.line < 1 || p.line > model.getLineCount()) continue;
			const markers = byFile.get(model) ?? [];
			markers.push({
				severity: monaco.MarkerSeverity.Error,
				message: p.message,
				source: "run",
				startLineNumber: p.line,
				startColumn: model.getLineFirstNonWhitespaceColumn(p.line) || 1,
				endLineNumber: p.line,
				endColumn: model.getLineMaxColumn(p.line),
			});
			byFile.set(model, markers);
		}
		for (const [model, markers] of byFile) monaco.editor.setModelMarkers(model, RUN_MARKERS, markers);
	}

	private showRunTarget(): void {
		const name = this.inputPath?.split("/").pop();
		byId("run-on").textContent = name ? `on ${name}` : "no input file";
		byId<HTMLButtonElement>("run").disabled = this.running || !name;
	}

	private renderFiles(): void {
		const entry = this.current!;
		const nav = byId("files");
		nav.replaceChildren();
		const section = (title: string) => {
			const h = document.createElement("h3");
			h.textContent = title;
			nav.append(h);
			const ol = document.createElement("ol");
			nav.append(ol);
			return ol;
		};
		const item = (list: HTMLElement, label: string, path: string | null, note = "", off = false) => {
			const li = document.createElement("li");
			if (off) li.classList.add("off");
			const b = document.createElement(path ? "button" : "span");
			b.textContent = label;
			if (path) {
				b.dataset.path = path;
				b.addEventListener("click", () => this.openPath(path));
			}
			li.append(b);
			if (note) {
				const s = document.createElement("small");
				s.textContent = note;
				li.append(s);
			}
			list.append(li);
		};

		const seqList = section("Passes");
		item(seqList, "analyzer.seq", "spec/analyzer.seq", "the order they run in");
		for (const p of this.passList) {
			// A rule pass is known by its file, a folder by its name, and a built-in pass
			// (tokenize nil) by what it does.
			const label = `${p.n ?? "–"}  ${p.file || p.n == null ? p.name : p.kind}`;
			item(seqList, label, p.file, p.comment || p.kind, !p.active);
		}
		const kb = entry.files.filter((f) => f.startsWith("kb/"));
		if (kb.length) {
			const list = section("Knowledge base");
			for (const f of kb) item(list, f.slice(3), f);
		}
		const input = entry.files.filter((f) => f.startsWith("input/"));
		if (input.length) {
			const list = section("Input");
			for (const f of input) item(list, f.slice(6), f);
		}
	}

	private showProblems(): void {
		const model = this.editor.getModel();
		const markers = model ? monaco.editor.getModelMarkers({ resource: model.uri }) : [];
		const el = byId("problems");
		el.replaceChildren();
		el.hidden = markers.length === 0;
		for (const m of markers.slice(0, 20)) {
			const b = document.createElement("button");
			b.textContent = `${m.startLineNumber}:${m.startColumn}  ${m.message}`;
			b.className = m.severity === monaco.MarkerSeverity.Error ? "error" : "warning";
			b.addEventListener("click", () => this.openPath(this.currentPath!, { lineNumber: m.startLineNumber, column: m.startColumn }));
			el.append(b);
		}
	}
}

async function main(): Promise<void> {
	const status = byId("status");
	const client = new NlpLanguageClient("language-server/browserServer.js");
	await Promise.all([installHighlighting(), client.start()]);
	installLanguageFeatures(client);

	const studio = new Studio(client);
	studio.analyzers = await loadIndex();

	const select = byId<HTMLSelectElement>("analyzer");
	for (const a of studio.analyzers) {
		const option = document.createElement("option");
		option.value = a.name;
		option.textContent = a.origin === "template" ? `${a.title} (template)` : a.title;
		select.append(option);
	}
	select.addEventListener("change", () => void studio.openAnalyzer(select.value));

	byId("theme").addEventListener("click", () => {
		document.documentElement.dataset.theme = darkTheme() ? "light" : "dark";
		monaco.editor.setTheme(darkTheme() ? THEMES.dark : THEMES.light);
	});

	const [health] = await Promise.all([
		serverHealth(),
		studio.analyzers.length ? studio.openAnalyzer(studio.analyzers[0].name) : undefined,
	]);
	status.textContent = health
		? `Edits stay in this tab and are not saved. Run (F5) uses NLPPlus ${health.engine ?? "of an unknown version"}.`
		: "Edits stay in this tab and are not saved. Running needs the run server: see the README.";

	const params = new URLSearchParams(location.search);
	if (params.has("selftest")) {
		const result = await selfTest(studio, { run: params.get("selftest") === "run" });
		await fetch("selftest-result", { method: "POST", body: JSON.stringify(result) });
	}
}

main().catch((err: unknown) => {
	byId("status").textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
	console.error(err);
});
