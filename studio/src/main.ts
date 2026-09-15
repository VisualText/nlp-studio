// NLP Studio: an NLP++ analyzer in the browser, edited with the language's own tools.
//
// Three pieces, none of them a server:
//
//   highlight.ts   colour, from the VS Code extension's TextMate grammars
//   lsp/client.ts  hover, definition, references, completion, rename, formatting,
//                  quick fixes and problems, from the extension's language server
//                  running in a Web Worker
//   analyzers.ts   the analyzers to open, fetched as static files
//
// Running an analyzer needs the engine and is not here yet; edits stay in the tab.
import "./styles.css";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { monaco } from "./monaco";
import { installHighlighting, THEMES } from "./highlight";
import { NlpLanguageClient, installLanguageFeatures } from "./lsp/client";
import { languageFor } from "./lsp/convert";
import { type AnalyzerEntry, fileUri, loadFiles, loadIndex, passes, pathOf } from "./analyzers";
import { selfTest } from "./selftest";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What the language server indexes across files.
const INDEXED = /\.(nlp|pat|kbb)$/i;

function darkTheme(): boolean {
	const set = document.documentElement.dataset.theme;
	return set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export class Studio {
	analyzers: AnalyzerEntry[] = [];
	current: AnalyzerEntry | undefined;
	currentPath: string | undefined;
	readonly editor: monaco.editor.IStandaloneCodeEditor;
	private readonly models = new Map<string, monaco.editor.ITextModel>();

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
	}

	async openAnalyzer(name: string): Promise<void> {
		const entry = this.analyzers.find((a) => a.name === name);
		if (!entry) return;
		const texts = await loadFiles(entry);
		for (const model of this.models.values()) model.dispose();
		this.models.clear();
		this.current = entry;
		for (const [path, text] of texts) {
			this.models.set(path, monaco.editor.createModel(text, languageFor(path), monaco.Uri.parse(fileUri(entry.name, path))));
		}
		await this.client.setFiles([...texts]
			.filter(([path]) => INDEXED.test(path))
			.map(([path, text]) => ({ uri: fileUri(entry.name, path), text })));
		this.renderFiles(texts.get("spec/analyzer.seq") ?? "");
		const first = passes(texts.get("spec/analyzer.seq") ?? "", entry.files).find((p) => p.file && p.active)?.file;
		this.openPath(first ?? "spec/analyzer.seq");
	}

	openPath(path: string, selection?: monaco.IRange | monaco.IPosition): void {
		const model = this.models.get(path);
		if (!model || !this.current) return;
		this.editor.setModel(model);
		this.client.open(model, path);
		this.currentPath = path;
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

	private renderFiles(seq: string): void {
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
		for (const p of passes(seq, entry.files)) {
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

	if (studio.analyzers.length) await studio.openAnalyzer(studio.analyzers[0].name);
	status.textContent = "Edits stay in this tab; nothing is saved or run.";

	if (new URLSearchParams(location.search).has("selftest")) {
		const result = await selfTest(studio);
		await fetch("selftest-result", { method: "POST", body: JSON.stringify(result) });
	}
}

main().catch((err: unknown) => {
	byId("status").textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
	console.error(err);
});
