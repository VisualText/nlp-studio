// The results of a run: the files it wrote, its problems, the engine's log.
//
// DOM and data only -- no Monaco. The parse tree is not here: trees can be very large, so
// they open in the editor (run/treeview.ts), from the file list or this panel's "Open the
// parse tree" button, through PanelHooks.
import type { RunProblem, RunResult, RunStatus } from "./api";

export interface PanelHooks {
	open(path: string, at?: { lineNumber: number; column: number }): void;
	openTree(name: string): void;
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

function pretty(name: string, text: string): string {
	if (!/\.json$/i.test(name)) return text;
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
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

	private renderOutput(result: RunResult): void {
		const files = Object.entries(result.output ?? {});
		if (!files.length) {
			if (result.status === "ok") this.body.append(make("p", "note", "The analyzer wrote no output files."));
			return;
		}
		for (const [name, text] of files) {
			this.body.append(make("h4", "file-name mono", name), make("pre", "file-text mono", pretty(name, text)));
		}
	}

	private renderProblems(result: RunResult, problems: RunProblem[]): void {
		if (!problems.length) {
			if (result.status === "ok") this.body.append(make("p", "note", "No problems reported."));
			return;
		}
		const list = make("div", "run-problems");
		for (const p of problems) {
			const where = p.file ? `${p.file}:${p.line}` : p.pass ? `pass ${p.pass}` : "analyzer";
			const row = make("button", "run-problem");
			row.append(make("span", "where mono", where), make("span", "what", p.message));
			if (p.file) row.addEventListener("click", () => this.hooks.open(p.file!, { lineNumber: Math.max(1, p.line), column: 1 }));
			else row.disabled = true;
			list.append(row);
		}
		this.body.append(list);
	}

	private renderLog(log: string[]): void {
		this.body.append(log.length ? make("pre", "log mono", log.join("\n")) : make("p", "note", "The engine logged nothing."));
	}
}
