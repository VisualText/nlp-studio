// NLP Studio: an NLP++ analyzer in the browser, edited with the language's own tools.
//
//   highlight.ts   colour, from the VS Code extension's TextMate grammars
//   lsp/client.ts  hover, definition, references, completion, rename, formatting,
//                  quick fixes and problems, from the extension's language server
//                  running in a Web Worker
//   analyzers.ts   the analyzers to open: the studio's samples, and (github/) any in a
//                  GitHub repository the person signed in can reach
//   drafts.ts      edits kept in this browser, until downloaded (zipfiles.ts)
//   run/           running one: its files go to the run server (server/app.py), and
//                  the output, parse tree and problems come back
import "./styles.css";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { monaco } from "./monaco";
import { installHighlighting, THEMES } from "./highlight";
import { NlpLanguageClient, installLanguageFeatures } from "./lsp/client";
import { languageFor } from "./lsp/convert";
import {
	type AnalyzerEntry, type Pass, fileUri, loadFiles, loadIndex, passes, pathOf, shownInKnowledgeBase,
} from "./analyzers";
import {
	type Account, type CommitResult, type FoundAnalyzer, type RecentAnalyzer, type RepoAnalyzers, type Repository,
	SIGN_IN_URL, account, analyzersIn, commitChanges as sendCommit, entryName, recent, remember, repositories, signOut,
} from "./github/api";
import { DraftStore } from "./drafts";
import { safeFolder, zipAnalyzer } from "./zipfiles";
import { type RunResult, runAnalyzer, serverHealth } from "./run/api";
import { RunPanel } from "./run/panel";
import { progress, selfTest } from "./selftest";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// What the language server indexes across files.
const INDEXED = /\.(nlp|pat|kbb)$/i;
// The last run's problems, as markers kept apart from the language server's so
// each set can be replaced without touching the other.
export const RUN_MARKERS = "nlp++ run";
// How long typing may pause before the draft is saved.
const SAVE_AFTER_MS = 500;

function darkTheme(): boolean {
	const set = document.documentElement.dataset.theme;
	return set ? set === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function button(text: string, onClick: () => void): HTMLButtonElement {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = text;
	b.addEventListener("click", onClick);
	return b;
}

export class Studio {
	analyzers: AnalyzerEntry[] = [];
	current: AnalyzerEntry | undefined;
	currentPath: string | undefined;
	// The input a run reads: the input file opened last, or the analyzer's first.
	inputPath: string | undefined;
	passList: Pass[] = [];
	account: Account | null = null;
	readonly editor: monaco.editor.IStandaloneCodeEditor;
	readonly panel: RunPanel;
	readonly drafts = DraftStore.browser();
	private readonly models = new Map<string, monaco.editor.ITextModel>();
	// Each file's text as it was opened, before any draft: what "changed" and "revert" mean.
	private readonly originals = new Map<string, string>();
	private readonly pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
	private repos: Repository[] = [];
	private draftsKept = true;
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

		byId("download").addEventListener("click", () => this.download());
		byId("commit").addEventListener("click", () => this.showCommitDialog());
		byId<HTMLFormElement>("commit-form").addEventListener("submit", (event) => {
			event.preventDefault();
			void this.submitCommitDialog();
		});
		byId("commit-cancel").addEventListener("click", () => byId<HTMLDialogElement>("commit-dialog").close());
		byId("revert-all").addEventListener("click", () => {
			const n = this.changedPaths().length;
			if (n && window.confirm(`Revert ${n} changed file${n === 1 ? "" : "s"} in ${this.current?.title}? Your edits will be lost.`)) {
				this.revert();
			}
		});
		// A draft waiting on its pause is saved before the page can go away.
		window.addEventListener("pagehide", () => this.flushDrafts());
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "hidden") this.flushDrafts();
		});

		byId("github-repo").addEventListener("change", () => {
			const repo = this.repos.find((r) => r.fullName === byId<HTMLSelectElement>("github-repo").value);
			if (repo) void this.listGitHubAnalyzers(repo.fullName, repo.defaultBranch);
		});
	}

	// Tell the person something in the header, in place of the status line.
	say(text: string): void {
		byId("status").textContent = text;
	}

	async openAnalyzer(name: string): Promise<void> {
		const entry = this.analyzers.find((a) => a.name === name);
		if (!entry) return;
		const texts = await loadFiles(entry);
		this.flushDrafts();
		for (const model of this.models.values()) model.dispose();
		this.models.clear();
		this.originals.clear();
		this.current = entry;
		const draft = this.drafts.load(entry.name);
		for (const [path, fetched] of texts) {
			// One line ending everywhere -- in what a draft is compared with, what is saved,
			// what runs and what downloads -- so a checkout with CRLF, or a file with both,
			// does not look changed before anyone has touched it.
			const original = fetched.replace(/\r\n?/g, "\n");
			this.originals.set(path, original);
			const text = draft?.files[path] ?? original;
			const model = monaco.editor.createModel(text, languageFor(path), monaco.Uri.parse(fileUri(entry.name, path)));
			model.setEOL(monaco.editor.EndOfLineSequence.LF);
			model.onDidChangeContent(() => {
				// A run's markers describe the text that ran; editing makes them stale.
				if (monaco.editor.getModelMarkers({ owner: RUN_MARKERS, resource: model.uri }).length) {
					monaco.editor.setModelMarkers(model, RUN_MARKERS, []);
				}
				this.scheduleSave(path);
			});
			this.models.set(path, model);
		}
		await this.client.setFiles([...this.models]
			.filter(([path]) => INDEXED.test(path))
			.map(([path, model]) => ({ uri: fileUri(entry.name, path), text: model.getValue() })));
		this.passList = passes(this.models.get("spec/analyzer.seq")?.getValue() ?? "", entry.files);
		this.inputPath = entry.files.find((f) => f.startsWith("input/"));
		this.panel.clear();
		this.renderFiles();
		this.renderChoices();
		this.showRunTarget();
		this.showChanges();
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
		const source = this.current.source;
		const where = source ? `${source.repo} @ ${source.commit.slice(0, 7)} / ` : "";
		byId("path").textContent = `${where}${this.current.title} / ${path}`;
		for (const el of byId("files").querySelectorAll<HTMLElement>("button[data-path]")) {
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

	// ---- GitHub ----------------------------------------------------------------------

	renderAccount(): void {
		const el = byId("account");
		el.replaceChildren();
		const who = this.account;
		if (!who?.github) return;
		if (!who.signedIn) {
			const link = document.createElement("a");
			link.href = SIGN_IN_URL;
			link.className = "button";
			link.textContent = "Sign in with GitHub";
			el.append(link);
			return;
		}
		const open = button("Open from GitHub", () => void this.showGitHubDialog());
		open.id = "github-open";
		const name = document.createElement("span");
		name.className = "muted";
		name.textContent = who.login ? `@${who.login}` : "";
		el.append(open, name);
		if (who.signIn) {
			el.append(button("Sign out", () => void signOut().then(() => location.reload())));
		}
	}

	async showGitHubDialog(): Promise<void> {
		const dialog = byId<HTMLDialogElement>("github-dialog");
		const select = byId<HTMLSelectElement>("github-repo");
		const note = byId("github-note");
		if (!dialog.open) dialog.showModal();
		select.replaceChildren();
		byId("github-analyzers").replaceChildren();
		note.textContent = "Looking for the repositories you can reach…";
		try {
			this.repos = await repositories();
		} catch (err) {
			note.textContent = messageOf(err);
			return;
		}
		for (const repo of this.repos) {
			const option = document.createElement("option");
			option.value = repo.fullName;
			option.textContent = repo.private ? `${repo.fullName} (private)` : repo.fullName;
			select.append(option);
		}
		if (!this.repos.length) {
			note.textContent = "No repositories are shared with NLP Studio for your account.";
			return;
		}
		await this.listGitHubAnalyzers(this.repos[0].fullName, this.repos[0].defaultBranch);
	}

	async listGitHubAnalyzers(repo: string, ref: string): Promise<void> {
		const select = byId<HTMLSelectElement>("github-repo");
		const note = byId("github-note");
		const list = byId("github-analyzers");
		select.value = repo;
		list.replaceChildren();
		note.textContent = `Looking for analyzers in ${repo}…`;
		let listing: RepoAnalyzers;
		try {
			listing = await analyzersIn(repo, ref);
		} catch (err) {
			if (select.value === repo) note.textContent = messageOf(err);
			return;
		}
		if (select.value !== repo) return; // another repository was chosen meanwhile
		const n = listing.analyzers.length;
		note.textContent = n
			? `${n} analyzer${n === 1 ? "" : "s"} on ${listing.ref} (${listing.commit.slice(0, 7)})`
			: `No analyzers in ${repo}: an analyzer is a folder holding spec/analyzer.seq.`;
		for (const found of listing.analyzers) {
			const item = document.createElement("li");
			const b = button("", () => {
				byId<HTMLDialogElement>("github-dialog").close();
				void this.openFromGitHub(listing, found);
			});
			b.dataset.folder = found.folder;
			const label = document.createElement("span");
			label.textContent = found.folder || "(the top of the repository)";
			const count = document.createElement("small");
			count.textContent = `${found.files.length} files`;
			b.append(label, count);
			item.append(b);
			list.append(item);
		}
	}

	// Open an analyzer found in a repository. False, and said in the header, if it could not be.
	async openFromGitHub(listing: RepoAnalyzers, found: FoundAnalyzer): Promise<boolean> {
		const entry: AnalyzerEntry = {
			name: entryName(listing.repo, listing.ref, found.folder),
			title: found.title,
			origin: "github",
			files: found.files,
			source: { repo: listing.repo, ref: listing.ref, commit: listing.commit, folder: found.folder },
		};
		this.analyzers = [...this.analyzers.filter((a) => a.name !== entry.name), entry];
		remember({ repo: listing.repo, ref: listing.ref, folder: found.folder, title: found.title });
		// Where it came from shows in the path bar (repository @ commit); the header only
		// says so while it loads, or if it could not.
		const before = byId("status").textContent ?? "";
		this.say(`Opening ${found.title} from ${listing.repo}…`);
		try {
			await this.openAnalyzer(entry.name);
			this.say(before);
			return true;
		} catch (err) {
			this.say(`Could not open ${found.title} from ${listing.repo}: ${messageOf(err)}`);
			return false;
		}
	}

	// Reopen a remembered GitHub analyzer, at the branch's latest commit.
	async openRecent(item: RecentAnalyzer): Promise<void> {
		this.say(`Opening ${item.title} from ${item.repo}…`);
		try {
			const listing = await analyzersIn(item.repo, item.ref);
			const found = listing.analyzers.find((a) => a.folder === item.folder);
			if (!found) throw new Error(`there is no longer an analyzer at ${item.folder || "the top"} on ${listing.ref}`);
			await this.openFromGitHub(listing, found);
		} catch (err) {
			this.say(`Could not open ${item.title} from ${item.repo}: ${messageOf(err)}`);
			this.renderChoices();
		}
	}

	// The analyzer menu: the samples, then GitHub analyzers opened now or before.
	renderChoices(): void {
		const select = byId<HTMLSelectElement>("analyzer");
		select.replaceChildren();
		const group = (label: string) => {
			const g = document.createElement("optgroup");
			g.label = label;
			select.append(g);
			return g;
		};
		const add = (parent: HTMLElement, value: string, text: string) => {
			const option = document.createElement("option");
			option.value = value;
			option.textContent = text;
			parent.append(option);
			return option;
		};
		const samples = group("Samples");
		for (const a of this.analyzers.filter((a) => !a.source)) {
			add(samples, a.name, a.origin === "template" ? `${a.title} (template)` : a.title);
		}
		const opened = this.analyzers.filter((a) => a.source);
		const remembered = this.account?.github ? recent() : [];
		if (opened.length || remembered.length) {
			const gh = group("GitHub");
			const shown = new Set<string>();
			for (const a of opened) {
				add(gh, a.name, `${a.title} · ${a.source!.repo}`);
				shown.add(a.name);
			}
			for (const r of remembered) {
				const name = entryName(r.repo, r.ref, r.folder);
				if (shown.has(name)) continue;
				add(gh, `recent:${name}`, `${r.title} · ${r.repo}`).dataset.recent = JSON.stringify(r);
				shown.add(name);
			}
		}
		if (this.current) select.value = this.current.name;
	}

	// ---- Committing to GitHub ----------------------------------------------------------

	// On a branch the studio made, a commit adds to it (and so to its pull request); from
	// any other branch it goes on a new branch with a pull request. Never onto the branch
	// the analyzer came from.
	private commitBranch(): string | undefined {
		const ref = this.current?.source?.ref;
		return ref?.startsWith("nlp-studio/") ? ref : undefined;
	}

	showCommitDialog(): void {
		const entry = this.current;
		const source = entry?.source;
		if (!entry || !source) return;
		this.flushDrafts();
		const changed = this.changedPaths();
		byId("commit-where").textContent = this.commitBranch()
			? `Adds a commit to ${source.ref}, which updates its pull request.`
			: `Puts ${changed.length === 1 ? "this change" : "these changes"} on a new branch, with a pull request into ${source.ref} of ${source.repo}.`;
		byId("commit-files").replaceChildren(...changed.map((path) => {
			const li = document.createElement("li");
			li.textContent = `${source.folder ? `${source.folder}/` : ""}${path}`;
			return li;
		}));
		const message = byId<HTMLInputElement>("commit-message");
		if (!message.value) message.value = `Update ${entry.title}`;
		byId("commit-result").replaceChildren();
		byId<HTMLButtonElement>("commit-submit").disabled = changed.length === 0;
		const dialog = byId<HTMLDialogElement>("commit-dialog");
		if (!dialog.open) dialog.showModal();
		message.focus();
	}

	private async submitCommitDialog(): Promise<void> {
		const submit = byId<HTMLButtonElement>("commit-submit");
		const out = byId("commit-result");
		submit.disabled = true;
		out.textContent = "Committing…";
		try {
			const result = await this.commitChanges(
				byId<HTMLInputElement>("commit-message").value, byId<HTMLTextAreaElement>("commit-description").value);
			const done = document.createElement("span");
			done.textContent = `Committed to ${result.branch}. `;
			out.replaceChildren(done);
			if (result.pullRequest) {
				const link = document.createElement("a");
				link.href = result.pullRequest.url;
				link.target = "_blank";
				link.rel = "noopener";
				link.textContent = `Pull request #${result.pullRequest.number}`;
				out.append(link);
			}
			byId<HTMLInputElement>("commit-message").value = "";
			byId<HTMLTextAreaElement>("commit-description").value = "";
			byId("commit-files").replaceChildren();
		} catch (err) {
			out.textContent = messageOf(err);
			submit.disabled = false;
		}
	}

	// Commit the changed files, then carry on editing from where they landed.
	async commitChanges(message: string, description = ""): Promise<CommitResult> {
		const entry = this.current;
		const source = entry?.source;
		if (!entry || !source) throw new Error("Only an analyzer opened from GitHub can be committed.");
		this.flushDrafts();
		const changed = this.changedPaths();
		if (!changed.length) throw new Error("Nothing has changed since it was opened.");
		const files = Object.fromEntries(changed.map((path) => [path, this.models.get(path)!.getValue()]));
		const result = await sendCommit({
			repo: source.repo, ref: source.ref, commit: source.commit, folder: source.folder,
			files, message, description, branch: this.commitBranch(),
		});
		// The edits are in that commit now: reopen from its branch, at it. Only once that has
		// worked are the drafts let go -- if it did not, the edits are still in this browser.
		const reopened = await this.openFromGitHub(
			{ repo: source.repo, ref: result.branch, commit: result.commit, analyzers: [] },
			{ folder: source.folder, title: entry.title, files: entry.files });
		if (reopened) this.drafts.discard(entry.name);
		return result;
	}

	// ---- Drafts --------------------------------------------------------------------

	// The files whose text differs from what was opened.
	changedPaths(): string[] {
		return [...this.models].filter(([path, model]) => model.getValue() !== this.originals.get(path)).map(([path]) => path);
	}

	// Save every draft still waiting on its pause.
	flushDrafts(): void {
		for (const path of [...this.pendingSaves.keys()]) this.saveDraft(path);
	}

	// Put files back as they were opened -- one, or all -- and forget their drafts.
	revert(path?: string): void {
		if (!this.current) return;
		for (const p of path === undefined ? this.changedPaths() : [path]) {
			const model = this.models.get(p);
			const original = this.originals.get(p);
			if (model && original !== undefined && model.getValue() !== original) model.setValue(original);
		}
		this.flushDrafts();
		this.draftsKept = this.drafts.discard(this.current.name, path) || !this.drafts.available;
		this.showChanges();
	}

	// Forget an analyzer's drafts without opening it (the self test starts clean this way).
	forgetDrafts(analyzer: string): void {
		if (this.current?.name === analyzer) this.flushDrafts();
		this.drafts.discard(analyzer);
	}

	// The open analyzer, with any edits, as a zip of its folder.
	analyzerZip(): Uint8Array {
		const entry = this.current!;
		return zipAnalyzer(entry.title, [...this.models].map(([path, model]) => [path, model.getValue()] as const));
	}

	download(): void {
		if (!this.current) return;
		const blob = new Blob([this.analyzerZip() as BlobPart], { type: "application/zip" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `${safeFolder(this.current.title)}.zip`;
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}

	private scheduleSave(path: string): void {
		clearTimeout(this.pendingSaves.get(path));
		this.pendingSaves.set(path, setTimeout(() => this.saveDraft(path), SAVE_AFTER_MS));
		this.showChanges();
	}

	private saveDraft(path: string): void {
		clearTimeout(this.pendingSaves.get(path));
		this.pendingSaves.delete(path);
		const model = this.models.get(path);
		const original = this.originals.get(path);
		if (!this.current || !model || original === undefined) return;
		this.draftsKept = this.drafts.save(this.current.name, path, model.getValue(), original);
		this.showChanges();
	}

	private showChanges(): void {
		const changed = new Set(this.changedPaths());
		for (const b of byId("files").querySelectorAll<HTMLElement>("button[data-path]")) {
			b.closest("li")?.classList.toggle("changed", changed.has(b.dataset.path!));
		}
		const note = byId("changes");
		note.title = "";
		byId("revert-all").hidden = changed.size === 0;
		byId("commit").hidden = !(this.current?.source && changed.size && this.account?.signedIn);
		if (!this.drafts.available) {
			note.textContent = changed.size ? `${changed.size} changed · NOT kept: this browser blocks storage` : "";
			note.className = "bad";
		} else if (!this.draftsKept) {
			note.textContent = `${changed.size} changed · could not save: browser storage is full`;
			note.className = "bad";
		} else {
			// Short, so the header stays on one line; where the edits are kept is in the tooltip.
			note.textContent = changed.size ? `${changed.size} changed` : "";
			note.title = changed.size ? "Your edits are kept in this browser until you commit, download or revert them." : "";
			note.className = "muted";
		}
	}

	// ---- Running -------------------------------------------------------------------

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

	// ---- The file list ---------------------------------------------------------------

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
			const row = document.createElement("div");
			row.className = "file-row";
			const b = document.createElement(path ? "button" : "span");
			b.textContent = label;
			row.append(b);
			if (path) {
				b.dataset.path = path;
				b.addEventListener("click", () => this.openPath(path));
				const revert = button("↺", () => {
					if (window.confirm(`Revert ${path}? Your edits to it will be lost.`)) this.revert(path);
				});
				revert.className = "revert";
				revert.title = `Revert ${path} to how it was opened`;
				row.append(revert);
			}
			li.append(row);
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
		const kb = entry.files.filter(shownInKnowledgeBase);
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

// Under the self test, each stage of starting up is reported, so a hang says where.
const selfTesting = new URLSearchParams(location.search).has("selftest");
const step = (text: string) => {
	if (selfTesting) progress(text);
};

async function main(): Promise<void> {
	step("page script started");
	const client = new NlpLanguageClient("language-server/browserServer.js");
	await Promise.all([installHighlighting(), client.start()]);
	installLanguageFeatures(client);
	step("colouring and language server ready");

	const studio = new Studio(client);
	const [analyzers, who] = await Promise.all([loadIndex(), account()]);
	step(`analyzer list and account loaded (${analyzers.length} analyzers, github=${who.github})`);
	studio.analyzers = analyzers;
	studio.account = who;
	studio.renderAccount();
	studio.renderChoices();

	const select = byId<HTMLSelectElement>("analyzer");
	select.addEventListener("change", () => {
		const remembered = select.selectedOptions[0]?.dataset.recent;
		if (remembered) {
			void studio.openRecent(JSON.parse(remembered) as RecentAnalyzer);
		} else {
			void studio.openAnalyzer(select.value).catch((err) => studio.say(`Could not open it: ${messageOf(err)}`));
		}
	});

	byId("theme").addEventListener("click", () => {
		document.documentElement.dataset.theme = darkTheme() ? "light" : "dark";
		monaco.editor.setTheme(darkTheme() ? THEMES.dark : THEMES.light);
	});

	const [health] = await Promise.all([
		serverHealth(),
		studio.analyzers.length ? studio.openAnalyzer(studio.analyzers[0].name) : undefined,
	]);
	step(`first analyzer open, run server ${health ? "answering" : "not answering"}`);
	// The header keeps to one line: the engine's version is on the Run button's tooltip, and the
	// status line only speaks when there is something to know.
	if (health) {
		byId("run").title = `Run the analyzer on the input file (F5), with NLPPlus ${health.engine ?? "of an unknown version"}`;
	}
	const kept = studio.drafts.available ? "" : "This browser blocks storage, so edits are not kept. ";
	studio.say(health ? kept.trim() : `${kept}Running needs the run server: see the README.`);

	const params = new URLSearchParams(location.search);
	if (params.has("selftest")) {
		const result = await selfTest(studio, { run: params.get("selftest") === "run" });
		await fetch("selftest-result", { method: "POST", body: JSON.stringify(result) });
	}
}

main().catch((err: unknown) => {
	byId("status").textContent = `Could not start: ${messageOf(err)}`;
	step(`could not start: ${messageOf(err)}`);
	console.error(err);
});
