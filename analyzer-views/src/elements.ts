// The analyzer's lists as web components, so any page -- plain DOM, React, anything --
// shows them the same way:
//
//   <nlp-sequence>        the passes, as the extension's ANALYZER SEQUENCE view
//   <nlp-knowledge-base>  the .dict and .kbb files, as its KNOWLEDGE BASE view
//   <nlp-output>          the files a run wrote, as its OUTPUT FILES view
//   <nlp-trees>           a run's parse trees: final.tree, and the tree after each pass
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
// LIGHT DOM, not a shadow root: the rows are ordinary buttons a page can style, test and
// query (button[data-path]). style.css draws them; its --nlp-* properties theme them.

import { type AnalyzerFile, fileSize, shownInKnowledgeBase, toFile } from "./files.js";
import { type IconName, fileIcon, iconElement, passIcon } from "./icons.js";
import { type TreeFile, outputOrder, treeLabel, treeNote, treeOrder, treeTitle } from "./runs.js";
import { type Pass, SEQUENCE_FILE, passes, passLabel, passTooltip } from "./sequence.js";

export interface OpenDetail {
	path: string;
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

// Properties a page may set before the element is defined (see connectedCallback).
const PROPERTIES = ["files", "sequence", "trees", "skipped", "selected", "changed"];

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
		// A property set before the element was defined sits on the instance and hides the
		// accessor; take it back through the accessor.
		const self = this as unknown as Record<string, unknown>;
		for (const key of PROPERTIES) {
			if (Object.hasOwn(this, key)) {
				const value = self[key];
				delete self[key];
				self[key] = value;
			}
		}
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

const ELEMENTS: [string, CustomElementConstructor][] = [
	["nlp-sequence", NlpSequence],
	["nlp-knowledge-base", NlpKnowledgeBase],
	["nlp-output", NlpOutput],
	["nlp-trees", NlpTrees],
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
	}
	interface HTMLElementEventMap {
		"nlp-open": CustomEvent<OpenDetail>;
		"nlp-revert": CustomEvent<OpenDetail>;
	}
}
