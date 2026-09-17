// The results of a run: what it wrote, its problems, and the engine's log.
//
// DOM and data only -- no Monaco. The Output tab lists the files the analyzer wrote, by name
// with their icons, as the extension's OUTPUT FILES view does; clicking one opens it in the
// editor through PanelHooks rather than dumping its text here. The file list holds the same
// files, and the parse trees, and opens them the same way.
import { readOutput } from "@visualtext/analyzer-views";
import { type RunProblem, type RunResult, type RunStatus, outputFiles } from "./api";

export interface PanelHooks {
	open(path: string, at?: { lineNumber: number; column: number }): void;
	openTree(name: string): void;
	openOutput(name: string): void;
}

export type Tab = "output" | "problems" | "log";

const HEADLINE: Record<RunStatus, string> = {
	ok: "Ran", failed: "Did not build", timeout: "Timed out", crashed: "Engine stopped",
	rejected: "Not run", busy: "Busy", invalid: "Not run", unauthorized: "Not signed in", unavailable: "No run server",
};

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	if (className) e.className = className;
	if (text) e.textContent = text;
	if (e instanceof HTMLButtonElement) e.type = "button";
	return e;
}

export class RunPanel {
	private result: RunResult | undefined;
	private readonly body: HTMLElement;
	private readonly summary: HTMLElement;
	private readonly tabs: HTMLButtonElement[];
	private readonly treeButton: HTMLButtonElement;

	constructor(private readonly section: HTMLElement, private readonly hooks: PanelHooks) {
		this.body = section.querySelector<HTMLElement>(".results-body")!;
		this.summary = section.querySelector<HTMLElement>(".results-summary")!;
		this.tabs = [...section.querySelectorAll<HTMLButtonElement>("[data-tab]")];
		this.treeButton = section.querySelector<HTMLButtonElement>(".results-tree")!;
		for (const tab of this.tabs) tab.addEventListener("click", () => this.showTab(tab.dataset.tab as Tab));
		this.treeButton.addEventListener("click", () => this.hooks.openTree("final.tree"));
		section.querySelector(".results-close")?.addEventListener("click", () => { section.hidden = true; });
	}

	clear(): void {
		this.result = undefined;
		this.section.hidden = true;
	}

	// A run has started: the panel says so at once, rather than showing the last run's results
	// until this one comes back.
	busy(what: string): void {
		this.result = undefined;
		this.section.hidden = false;
		this.summary.textContent = what;
		this.summary.dataset.status = "busy";
		this.treeButton.hidden = true;
		this.body.replaceChildren(make("p", "note", "Running…"));
	}

	show(result: RunResult): void {
		this.result = result;
		this.section.hidden = false;

		const facts = [HEADLINE[result.status] ?? result.status];
		if (result.ms !== undefined) facts.push(`${result.ms} ms`);
		if (result.engine) facts.push(`NLPPlus ${result.engine}`);
		this.summary.textContent = facts.join(" · ");
		this.summary.dataset.status = result.status;
		this.treeButton.hidden = !result.trees?.files.some((f) => f.name === "final.tree");

		const problems = result.problems?.length ?? 0;
		const problemsTab = this.tabs.find((t) => t.dataset.tab === "problems");
		if (problemsTab) problemsTab.textContent = problems ? `Problems (${problems})` : "Problems";
		const wrote = Object.keys(result.output ?? {}).length;
		const outputTab = this.tabs.find((t) => t.dataset.tab === "output");
		if (outputTab) outputTab.textContent = wrote ? `Output (${wrote})` : "Output";
		this.showTab(problems ? "problems" : "output");
	}

	showTab(tab: Tab): void {
		for (const t of this.tabs) t.setAttribute("aria-selected", String(t.dataset.tab === tab));
		this.body.replaceChildren();
		const result = this.result;
		if (!result) return;
		if (result.status !== "ok") this.body.append(make("p", "note bad", result.message));
		if (tab === "output") this.renderOutput(result);
		else if (tab === "problems") this.renderProblems(result, result.problems ?? []);
		else this.renderLog(result.log ?? []);
	}

	// The values output.json filled, then the files the run wrote, by name: click one to
	// open it in the editor.
	private renderOutput(result: RunResult): void {
		const files = outputFiles(result);
		if (!files.length) {
			this.body.append(make("p", "note", result.status === "ok"
				? "The analyzer wrote no output files."
				: "Nothing was written: the run did not finish."));
			return;
		}
		const json = result.output?.["output.json"];
		if (json !== undefined) {
			const read = readOutput(json);
			if ("error" in read) {
				this.body.append(make("p", "note bad", read.error));
			} else {
				const values = document.createElement("nlp-values");
				values.className = "run-values";
				values.output = read.output;
				this.body.append(values);
			}
		}
		// The same list as the file list's Output (@visualtext/analyzer-views), without its heading.
		const list = document.createElement("nlp-output");
		list.setAttribute("heading", "");
		list.className = "run-files";
		list.files = files;
		list.addEventListener("nlp-open", (e) => this.hooks.openOutput(e.detail.path));
		this.body.append(list);
	}

	// The problems, and on their own tab the engine's log: <nlp-log> from
	// @visualtext/analyzer-views, as other pages show a run's log. A problem in a pass file
	// opens it at its line.
	private renderProblems(result: RunResult, problems: RunProblem[]): void {
		if (!problems.length) {
			if (result.status === "ok") this.body.append(make("p", "note", "No problems reported."));
			return;
		}
		this.body.append(this.log({ problems }));
	}

	private renderLog(log: string[]): void {
		this.body.append(log.length ? this.log({ lines: log }) : make("p", "note", "The engine logged nothing."));
	}

	private log(what: { problems?: RunProblem[]; lines?: string[] }): HTMLElement {
		const el = document.createElement("nlp-log");
		el.setAttribute("heading", "");
		el.className = "run-log";
		el.problems = what.problems;
		el.lines = what.lines;
		el.addEventListener("nlp-open", (e) => this.hooks.open(e.detail.path, { lineNumber: e.detail.line ?? 1, column: 1 }));
		return el;
	}
}
