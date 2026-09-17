// The analyzer's lists as web components, so any page -- plain DOM, React, anything --
// shows them the same way:
//
//   <nlp-sequence>        the passes, as the extension's ANALYZER SEQUENCE view
//   <nlp-knowledge-base>  the .dict and .kbb files, as its KNOWLEDGE BASE view
//   <nlp-output>          the files a run wrote, as its OUTPUT FILES view
//   <nlp-trees>           a run's parse trees: final.tree, and the tree after each pass
//   <nlp-code>            a file's text, read-only, coloured by NLP++'s own grammars
//   <nlp-log>             a run's problems, each opening its pass at its line, and its log
//   <nlp-values>          the values a run's output.json filled, by field
//
// Give one what to list; it says when a file is picked:
//
//   const seq = document.createElement("nlp-sequence");
//   seq.files = ["spec/analyzer.seq", "spec/funcs.nlp", "kb/user/hier.kb"];
//   seq.sequence = seqText;
//   seq.addEventListener("nlp-open", (e) => open(e.detail.path));
//
// Properties:  files      paths, or { path, bytes } to show sizes (all but <nlp-trees>)
//              sequence   the text of spec/analyzer.seq (<nlp-sequence>)
//              trees      { name, pass, passName, bytes } and skipped, names too large
//                         to keep (<nlp-trees>)
//              selected   the path open now, drawn as selected
//              changed    paths with unsaved edits, marked, with a revert button when
//                         the element has the `revertable` attribute
// Attributes:  heading    the list's heading; heading="" for none
//              revertable offer a revert button on a changed file
// Events:      nlp-open   { path }  a file was clicked (a tree by its name)
//              nlp-revert { path }  its revert button was clicked
//
// <nlp-code> takes text, and a path or a language attribute to pick the grammar; <nlp-log>
// takes problems and lines; <nlp-values> takes output (see their classes).
//
// LIGHT DOM, not a shadow root: the rows are ordinary buttons a page can style, test and
// query (button[data-path]). style.css draws them; its --nlp-* properties theme them.

import { type AnalyzerFile, fileSize, shownInKnowledgeBase, toFile } from "./files.js";
import { nlpTokens } from "./highlight.js";
import { type IconName, fileIcon, iconElement, passIcon } from "./icons.js";
import { type NlpLanguage, NLP_LANGUAGES, langFor } from "./languages.js";
import { type Problem, logLines, problemWhere } from "./logs.js";
import { type FilledField, filledFields } from "./values.js";
import { type TreeFile, outputOrder, treeLabel, treeNote, treeOrder, treeTitle } from "./runs.js";
import { type Pass, SEQUENCE_FILE, passes, passLabel, passTooltip } from "./sequence.js";

export interface OpenDetail {
	path: string;
	line?: number;          // <nlp-log>: the line the problem is on
}

interface Row {
	label: string;          // "": no name line, only the note
	path: string | null;    // null: listed, but nothing to open
	icon: IconName;
	title?: string;
	size?: string;
	note?: string;          // a line under the name
	classes?: string[];
}

// A property set on an element before it was defined sits on the instance and hides the
// class's accessor; take it back through the accessor.
function upgradeProperties(el: HTMLElement, keys: string[]): void {
	const self = el as unknown as Record<string, unknown>;
	for (const key of keys) {
		if (Object.hasOwn(el, key)) {
			const value = self[key];
			delete self[key];
			self[key] = value;
		}
	}
}

// Outside a browser there is no HTMLElement; the classes still load, so the package's
// entry point can be imported for its rules.
const Base = (globalThis.HTMLElement ?? class {}) as typeof HTMLElement;

abstract class AnalyzerList extends Base {
	#selected: string | null = null;
	#changed = new Set<string>();

	static observedAttributes = ["heading", "revertable"];

	protected abstract readonly defaultHeading: string;
	protected abstract rows(): Row[];

	get selected(): string | null {
		return this.#selected;
	}
	set selected(path: string | null | undefined) {
		this.#selected = path ?? null;
		this.mark();
	}

	get changed(): ReadonlySet<string> {
		return this.#changed;
	}
	set changed(paths: Iterable<string> | null | undefined) {
		this.#changed = new Set(paths ?? []);
		this.mark();
	}

	connectedCallback(): void {
		upgradeProperties(this, ["files", "sequence", "trees", "skipped", "selected", "changed"]);
		this.render();
	}

	attributeChangedCallback(): void {
		this.render();
	}

	protected render(): void {
		if (!this.isConnected) return;
		const rows = this.rows();
		this.hidden = rows.length === 0;
		const heading = this.getAttribute("heading") ?? this.defaultHeading;
		const list = document.createElement("ol");
		list.className = "nlp-list";
		for (const row of rows) list.append(this.item(row));
		if (heading) {
			const h = document.createElement("h3");
			h.className = "nlp-heading";
			h.textContent = heading;
			this.replaceChildren(h, list);
		} else {
			this.replaceChildren(list);
		}
		this.mark();
	}

	private item(row: Row): HTMLLIElement {
		const li = document.createElement("li");
		li.className = ["nlp-item", ...(row.classes ?? [])].join(" ");
		if (row.label) li.append(this.line(row, li));
		if (row.note) {
			const note = document.createElement("small");
			note.className = "nlp-note";
			note.textContent = row.note;
			li.append(note);
		}
		return li;
	}

	private line(row: Row, li: HTMLLIElement): HTMLElement {
		const line = document.createElement("div");
		line.className = "nlp-row";
		const name = document.createElement(row.path ? "button" : "span");
		name.className = "nlp-name";
		name.textContent = row.label;
		if (row.title) name.title = row.title;
		line.append(iconElement(row.icon), name);
		if (row.size) {
			const size = document.createElement("span");
			size.className = "nlp-size";
			size.textContent = row.size;
			line.append(size);
		}
		const path = row.path;
		if (path && name instanceof HTMLButtonElement) {
			name.type = "button";
			name.dataset.path = path;
			li.dataset.path = path;
			name.addEventListener("click", () => this.emit("nlp-open", path));
			if (this.hasAttribute("revertable")) {
				const revert = document.createElement("button");
				revert.type = "button";
				revert.className = "nlp-revert";
				revert.textContent = "↺";
				revert.title = `Revert ${path} to how it was opened`;
				revert.addEventListener("click", () => this.emit("nlp-revert", path));
				line.append(revert);
			}
		}
		return line;
	}

	private emit(type: "nlp-open" | "nlp-revert", path: string): void {
		this.dispatchEvent(new CustomEvent<OpenDetail>(type, { detail: { path }, bubbles: true, composed: true }));
	}

	// Selection and changes, without rebuilding the rows.
	private mark(): void {
		for (const li of this.querySelectorAll<HTMLElement>("li[data-path]")) {
			const path = li.dataset.path!;
			li.classList.toggle("changed", this.#changed.has(path));
			li.querySelector(".nlp-name")?.classList.toggle("on", path === this.#selected);
		}
	}
}

// A list drawn from the analyzer's files, or a run's.
abstract class FileList extends AnalyzerList {
	#files: AnalyzerFile[] = [];

	get files(): AnalyzerFile[] {
		return this.#files;
	}
	set files(files: Iterable<string | AnalyzerFile> | null | undefined) {
		this.#files = [...(files ?? [])].map(toFile);
		this.filesChanged();
		this.render();
	}

	protected filesChanged(): void {}
}

export class NlpSequence extends FileList {
	#sequence = "";
	#passes: Pass[] | null = null;

	protected readonly defaultHeading = "Analyzer Sequence";

	// The text of spec/analyzer.seq.
	get sequence(): string {
		return this.#sequence;
	}
	set sequence(text: string | null | undefined) {
		this.#sequence = text ?? "";
		this.#passes = null;
		this.render();
	}

	// The passes as listed: read from `sequence` against `files`.
	get passes(): Pass[] {
		return this.#passes ??= passes(this.#sequence, this.files.map((f) => f.path));
	}

	protected override filesChanged(): void {
		this.#passes = null;
	}

	protected rows(): Row[] {
		const rows: Row[] = [];
		if (this.files.some((f) => f.path === SEQUENCE_FILE)) {
			rows.push({ label: "analyzer.seq", path: SEQUENCE_FILE, icon: "blank",
				title: "The sequence file: the order the passes run in", classes: ["sequence-file"] });
		}
		for (const p of this.passes) {
			const says = passTooltip(p);
			const classes = [p.active ? "" : "off", p.folder ? "in-folder" : "", p.n === null ? "group" : ""].filter(Boolean);
			rows.push({
				label: `${p.n ?? "–"} ${passLabel(p)}`,
				path: p.file,
				icon: passIcon(p.kind, p.active),
				title: p.active ? says : `${says} — switched off`,
				classes,
			});
		}
		return rows;
	}
}

export class NlpKnowledgeBase extends FileList {
	protected readonly defaultHeading = "Knowledge base";

	protected rows(): Row[] {
		return this.files.filter((f) => shownInKnowledgeBase(f.path)).map((f) => ({
			label: f.path.slice("kb/".length),
			path: f.path,
			icon: fileIcon(f.path),
			title: f.path,
			size: fileSize(f.bytes),
		}));
	}
}

export class NlpOutput extends FileList {
	protected readonly defaultHeading = "Output";

	protected rows(): Row[] {
		return outputOrder(this.files).map((f) => ({
			label: f.path,
			path: f.path,
			icon: fileIcon(f.path),
			title: `Open ${f.path}, as the run wrote it`,
			size: fileSize(f.bytes),
		}));
	}
}

export class NlpTrees extends AnalyzerList {
	#trees: TreeFile[] = [];
	#skipped: string[] = [];

	protected readonly defaultHeading = "Parse trees";

	get trees(): TreeFile[] {
		return this.#trees;
	}
	set trees(trees: Iterable<TreeFile> | null | undefined) {
		this.#trees = treeOrder(trees ?? []);
		this.render();
	}

	// Trees the run wrote but did not keep, being too large.
	get skipped(): string[] {
		return this.#skipped;
	}
	set skipped(names: Iterable<string> | null | undefined) {
		this.#skipped = [...(names ?? [])];
		this.render();
	}

	protected rows(): Row[] {
		const rows: Row[] = this.#trees.map((t) => ({
			label: treeLabel(t),
			path: t.name,
			icon: "tree",
			title: `Open the ${treeTitle(t)}`,
			note: treeNote(t),
		}));
		if (this.#skipped.length) {
			rows.push({ label: "", path: null, icon: "blank", note: `Too large to keep: ${this.#skipped.join(", ")}`,
				classes: ["skipped"] });
		}
		return rows;
	}
}

// A file's text, read-only, coloured as the VS Code extension colours it.
//
//   const code = document.createElement("nlp-code");
//   code.path = "spec/funcs.nlp";      // picks the grammar; or set language="tree"
//   code.text = source;
//   code.line = 12;                    // marks line 12 and scrolls it into view
//
// The text shows plain at once, and coloured when the grammars have loaded; a file that
// is not NLP++, or is too long to colour, stays plain. Tokens are spans with text content
// -- no HTML string from the file is ever parsed.
export class NlpCode extends Base {
	#text = "";
	#path: string | null = null;
	#line: number | null = null;
	#drawn = 0;   // which render the tokens that arrive belong to

	static observedAttributes = ["language"];

	get text(): string {
		return this.#text;
	}
	set text(text: string | null | undefined) {
		this.#text = text ?? "";
		this.render();
	}

	// The file's path, to pick its grammar by name. The language attribute overrides it.
	get path(): string | null {
		return this.#path;
	}
	set path(path: string | null | undefined) {
		this.#path = path ?? null;
		this.render();
	}

	// A line to mark and bring into view, counting from 1; null for none.
	get line(): number | null {
		return this.#line;
	}
	set line(line: number | null | undefined) {
		this.#line = line && line > 0 ? line : null;
		this.markLine(true);
	}

	// The grammar it is coloured with: the language attribute, else the path's.
	get language(): NlpLanguage | null {
		const set = this.getAttribute("language");
		if (set !== null) return (NLP_LANGUAGES as readonly string[]).includes(set) ? set as NlpLanguage : null;
		return langFor(this.#path);
	}

	connectedCallback(): void {
		upgradeProperties(this, ["text", "path", "line"]);
		this.render();
	}

	attributeChangedCallback(): void {
		this.render();
	}

	private render(): void {
		if (!this.isConnected) return;
		const drawn = ++this.#drawn;
		// One span per line, so a line can be marked; the line breaks stay text between them.
		this.replaceChildren(this.lines(this.#text.split(/\r?\n/).map((text) => [text]), false));
		this.markLine(true);
		const text = this.#text;
		nlpTokens(text, this.language).then((lines) => {
			if (!lines || drawn !== this.#drawn) return;
			this.replaceChildren(this.lines(lines.map((line) => line.map((token) => {
				const span = document.createElement("span");
				span.textContent = token.content;
				for (const [prop, value] of Object.entries(token.htmlStyle ?? {})) span.style.setProperty(prop, value);
				return span;
			})), true));
			this.markLine(false);
		}).catch(() => {
			// The plain text stays, and is still right.
		});
	}

	private lines(lines: (string | Node)[][], coloured: boolean): HTMLPreElement {
		const pre = document.createElement("pre");
		pre.className = coloured ? "nlp-code coloured" : "nlp-code";
		lines.forEach((parts, i) => {
			const line = document.createElement("span");
			line.className = "nlp-line";
			line.append(...parts);
			pre.append(line);
			if (i < lines.length - 1) pre.append("\n");
		});
		return pre;
	}

	// Mark the line, and bring it into view when it was just asked for.
	private markLine(reveal: boolean): void {
		const lines = this.querySelectorAll<HTMLElement>(".nlp-line");
		lines.forEach((line, i) => line.classList.toggle("on", i + 1 === this.#line));
		const on = this.#line ? lines[this.#line - 1] : undefined;
		if (on && reveal) on.scrollIntoView?.({ block: "center" });
	}
}

// A run's problems and its log, as the extension's LOGGING view: each problem names where
// it is and says what went wrong, and opens its pass at its line when the pass has a file.
//
//   const log = document.createElement("nlp-log");
//   log.problems = problemsInLog(errLog, seqText, paths);   // or a run server's problems
//   log.lines = errLog;                                      // the log itself, under them
//   log.addEventListener("nlp-open", (e) => open(e.detail.path, e.detail.line));
//
// Heading "Log" by default; heading="" for none. Hidden with nothing to show.
export class NlpLog extends Base {
	#problems: Problem[] = [];
	#lines: string[] = [];

	static observedAttributes = ["heading"];

	get problems(): Problem[] {
		return this.#problems;
	}
	set problems(problems: Iterable<Problem> | null | undefined) {
		this.#problems = [...(problems ?? [])];
		this.render();
	}

	// The log's lines: an array, or its text.
	get lines(): string[] {
		return this.#lines;
	}
	set lines(lines: string | readonly string[] | null | undefined) {
		this.#lines = logLines(lines);
		this.render();
	}

	connectedCallback(): void {
		upgradeProperties(this, ["problems", "lines"]);
		this.render();
	}

	attributeChangedCallback(): void {
		this.render();
	}

	private render(): void {
		if (!this.isConnected) return;
		this.hidden = this.#problems.length === 0 && this.#lines.length === 0;
		const parts: HTMLElement[] = [];
		const heading = this.getAttribute("heading") ?? "Log";
		if (heading) {
			const h = document.createElement("h3");
			h.className = "nlp-heading";
			h.textContent = heading;
			parts.push(h);
		}
		if (this.#problems.length) {
			const list = document.createElement("ol");
			list.className = "nlp-list nlp-problems";
			for (const problem of this.#problems) list.append(this.problem(problem));
			parts.push(list);
		}
		if (this.#lines.length) {
			const pre = document.createElement("pre");
			pre.className = "nlp-log-lines";
			pre.textContent = this.#lines.join("\n");
			parts.push(pre);
		}
		this.replaceChildren(...parts);
	}

	private problem(problem: Problem): HTMLLIElement {
		const li = document.createElement("li");
		li.className = "nlp-item nlp-problem";
		const row = document.createElement(problem.file ? "button" : "div");
		row.className = "nlp-problem-row";
		const where = document.createElement("span");
		where.className = "nlp-where";
		where.textContent = problemWhere(problem);
		const message = document.createElement("span");
		message.className = "nlp-message";
		message.textContent = problem.message;
		row.append(where, message);
		const file = problem.file;
		if (file && row instanceof HTMLButtonElement) {
			row.type = "button";
			row.dataset.path = file;
			row.title = `Open ${file} at line ${problem.line}`;
			const line = Math.max(1, problem.line);
			row.addEventListener("click", () => this.dispatchEvent(new CustomEvent<OpenDetail>("nlp-open",
				{ detail: { path: file, line }, bubbles: true, composed: true })));
		}
		li.append(row);
		return li;
	}
}

// The values a run found: the fields its output.json filled, by dotted path, as a table.
//
//   const values = document.createElement("nlp-values");
//   values.output = JSON.parse(outputJson);
//
// Heading "Values found" by default; heading="" for none. With output but nothing filled
// it says so -- the analyzer looked and found nothing, which is an answer. With no output
// at all it is hidden.
export class NlpValues extends Base {
	#output: unknown = undefined;
	#fields: FilledField[] = [];

	static observedAttributes = ["heading"];

	get output(): unknown {
		return this.#output;
	}
	set output(output: unknown) {
		this.#output = output;
		this.#fields = filledFields(output);
		this.render();
	}

	// The filled fields, as [path, value].
	get fields(): FilledField[] {
		return this.#fields;
	}

	connectedCallback(): void {
		upgradeProperties(this, ["output"]);
		this.render();
	}

	attributeChangedCallback(): void {
		this.render();
	}

	private render(): void {
		if (!this.isConnected) return;
		this.hidden = this.#output === undefined || this.#output === null;
		const parts: HTMLElement[] = [];
		const heading = this.getAttribute("heading") ?? "Values found";
		if (heading) {
			const h = document.createElement("h3");
			h.className = "nlp-heading";
			h.textContent = heading;
			parts.push(h);
		}
		if (this.#fields.length) {
			const table = document.createElement("table");
			table.className = "nlp-values";
			const head = table.createTHead().insertRow();
			for (const title of ["Field", "Value"]) {
				const th = document.createElement("th");
				th.textContent = title;
				head.append(th);
			}
			const body = table.createTBody();
			for (const [path, value] of this.#fields) {
				const row = body.insertRow();
				const field = row.insertCell();
				field.className = "nlp-field";
				field.textContent = path;
				row.insertCell().textContent = value;
			}
			parts.push(table);
		} else if (!this.hidden) {
			const note = document.createElement("p");
			note.className = "nlp-values-empty";
			note.textContent = "Every field is empty: the analyzer looked and found nothing it recognizes. That is an answer, not a failure.";
			parts.push(note);
		}
		this.replaceChildren(...parts);
	}
}

const ELEMENTS: [string, CustomElementConstructor][] = [
	["nlp-sequence", NlpSequence],
	["nlp-knowledge-base", NlpKnowledgeBase],
	["nlp-output", NlpOutput],
	["nlp-trees", NlpTrees],
	["nlp-code", NlpCode],
	["nlp-log", NlpLog],
	["nlp-values", NlpValues],
];

// Registers the elements, once. The package's entry point calls it; a page that loads
// the classes some other way can call it itself.
export function defineAnalyzerViews(registry: CustomElementRegistry | undefined = globalThis.customElements): void {
	if (!registry) return;
	for (const [name, element] of ELEMENTS) {
		if (!registry.get(name)) registry.define(name, element);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"nlp-sequence": NlpSequence;
		"nlp-knowledge-base": NlpKnowledgeBase;
		"nlp-output": NlpOutput;
		"nlp-trees": NlpTrees;
		"nlp-code": NlpCode;
		"nlp-log": NlpLog;
		"nlp-values": NlpValues;
	}
	interface HTMLElementEventMap {
		"nlp-open": CustomEvent<OpenDetail>;
		"nlp-revert": CustomEvent<OpenDetail>;
	}
}
