// The results of a run: the files it wrote, its parse tree, its problems, the engine's log.
//
// DOM and data only -- no Monaco. Opening a file or selecting text goes through
// PanelHooks, which the studio implements.
//
// The parse tree is where NLP++ shows its work: every node the rules built can be
// clicked to select the text it covers, and its rule link opens the line of the
// pass that built it.
import type { RunProblem, RunResult, RunStatus } from "./api";
import { displayName, parseTree, spanOf, type TreeNode, utf16Offsets } from "./tree";

export interface RunContext {
	text: string;                          // the input exactly as it was sent
	inputPath: string;                     // the input file it came from
	passFile(pass: number): string | null; // the spec/ file of a pass number
}

export interface PanelHooks {
	open(path: string, at?: { lineNumber: number; column: number }): void;
	selectInput(path: string, from: number, to: number): void;
}

export type Tab = "output" | "tree" | "problems" | "log";

const MAX_NODES = 5000;
const SNIPPET = 48;

const HEADLINE: Record<RunStatus, string> = {
	ok: "Ran", failed: "Did not build", timeout: "Timed out", crashed: "Engine stopped",
	rejected: "Not run", busy: "Busy", invalid: "Not run", unavailable: "No run server",
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

function snippet(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
}

export class RunPanel {
	private result: RunResult | undefined;
	private context: RunContext | undefined;
	private root: TreeNode | undefined;
	private readonly body: HTMLElement;
	private readonly summary: HTMLElement;
	private readonly tabs: HTMLButtonElement[];

	constructor(private readonly section: HTMLElement, private readonly hooks: PanelHooks) {
		this.body = section.querySelector<HTMLElement>(".results-body")!;
		this.summary = section.querySelector<HTMLElement>(".results-summary")!;
		this.tabs = [...section.querySelectorAll<HTMLButtonElement>("[data-tab]")];
		for (const tab of this.tabs) tab.addEventListener("click", () => this.showTab(tab.dataset.tab as Tab));
		section.querySelector(".results-close")?.addEventListener("click", () => { section.hidden = true; });
	}

	clear(): void {
		this.result = undefined;
		this.context = undefined;
		this.root = undefined;
		this.section.hidden = true;
	}

	show(result: RunResult, context: RunContext): void {
		this.result = result;
		this.context = context;
		this.root = result.tree ? parseTree(result.tree) : undefined;
		this.section.hidden = false;

		const facts = [HEADLINE[result.status] ?? result.status];
		if (result.ms !== undefined) facts.push(`${result.ms} ms`);
		if (result.engine) facts.push(`NLPPlus ${result.engine}`);
		this.summary.textContent = facts.join(" · ");
		this.summary.dataset.status = result.status;

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
		else if (tab === "tree") this.renderTree(result);
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

	private renderTree(result: RunResult): void {
		const ctx = this.context;
		if (!this.root || !ctx) {
			if (result.status === "ok") this.body.append(make("p", "note", "The engine wrote no parse tree."));
			return;
		}
		const offsets = utf16Offsets(ctx.text);
		let shown = 0;
		let cut = false;

		const build = (node: TreeNode): HTMLElement => {
			shown++;
			const row = make("div", "tree-row");
			const button = make("button", node.built ? "node built" : "node", displayName(node.name));
			button.dataset.name = node.name;
			const span = spanOf(node, offsets);
			if (span) {
				button.title = `Select this ${node.type === "node" ? "node" : node.type}'s text in ${ctx.inputPath}`;
				button.addEventListener("click", (e) => {
					e.preventDefault(); // inside <summary>: select, do not fold
					this.hooks.selectInput(ctx.inputPath, span[0], span[1]);
				});
			}
			row.append(button);
			if (node.children.length && span) row.append(make("span", "snippet", snippet(ctx.text.slice(span[0], span[1]))));
			if (node.pass > 0 && node.line > 0) {
				const file = ctx.passFile(node.pass);
				const rule = make("button", "rule mono", `${file ? file.replace(/^spec\//, "") : `pass ${node.pass}`}:${node.line}`);
				rule.disabled = !file;
				rule.title = file ? `Open the rule that built ${node.name}` : "This pass has no file in the analyzer";
				if (file) {
					rule.addEventListener("click", (e) => {
						e.preventDefault();
						this.hooks.open(file, { lineNumber: node.line, column: 1 });
					});
				}
				row.append(rule);
			}
			if (!node.children.length) return row;

			const branch = make("details", "tree-branch");
			branch.open = node.depth < 2;
			const summary = make("summary");
			summary.append(row);
			branch.append(summary);
			for (const child of node.children) {
				if (shown >= MAX_NODES) {
					cut = true;
					break;
				}
				branch.append(build(child));
			}
			return branch;
		};

		const tree = make("div", "tree mono");
		tree.append(build(this.root));
		this.body.append(tree);
		if (cut) this.body.append(make("p", "note", `The tree is cut off after ${MAX_NODES} nodes.`));
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
