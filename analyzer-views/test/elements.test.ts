import { beforeEach, describe, expect, it } from "vitest";
import "../src/index.js";
import type { NlpKnowledgeBase, NlpSequence } from "../src/elements.js";

const FILES = ["spec/analyzer.seq", "spec/funcs.nlp", "spec/off.nlp", "kb/user/hier.kb", "kb/user/colors.dict", "input/a.txt"];
const SEQ = "tokenize\tnil\t# split it\nnlp\tfuncs\t# helpers\n/nlp\toff\t# not now";

const paths = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>("button.nlp-name")].map((b) => b.dataset.path);

beforeEach(() => document.body.replaceChildren());

describe("<nlp-sequence>", () => {
	const make = () => {
		const el = document.createElement("nlp-sequence");
		el.files = FILES;
		el.sequence = SEQ;
		document.body.append(el);
		return el;
	};

	it("lists the sequence file and the passes, under its heading", () => {
		const el = make();
		expect(el.querySelector("h3")?.textContent).toBe("Analyzer Sequence");
		expect([...el.querySelectorAll(".nlp-name")].map((n) => n.textContent))
			.toEqual(["analyzer.seq", "1 tokenize", "2 funcs", "3 off"]);
		expect(paths(el)).toEqual(["spec/analyzer.seq", "spec/funcs.nlp", "spec/off.nlp"]);
	});
	it("draws each pass with its icon, its comment as the mouse-over, and a switched-off pass greyed", () => {
		const el = make();
		const items = [...el.querySelectorAll("li")];
		expect(items.map((li) => li.querySelector(".nlp-icon")?.classList[1])).toEqual(["blank", "dot", "dna", "dna-off"]);
		expect(items[2].querySelector(".nlp-name")?.getAttribute("title")).toBe("helpers");
		expect(items[2].querySelector("svg")).not.toBeNull();
		expect(items[3].classList.contains("off")).toBe(true);
		expect(items[3].querySelector(".nlp-name")?.getAttribute("title")).toBe("not now — switched off");
	});
	it("says which file was clicked", () => {
		const el = make();
		const opened: string[] = [];
		document.body.addEventListener("nlp-open", (e) => opened.push(e.detail.path));
		el.querySelector<HTMLButtonElement>('button[data-path="spec/funcs.nlp"]')!.click();
		expect(opened).toEqual(["spec/funcs.nlp"]);
	});
	it("marks the open file and changed files, without rebuilding the rows", () => {
		const el = make();
		const row = el.querySelector('button[data-path="spec/funcs.nlp"]')!;
		el.selected = "spec/funcs.nlp";
		el.changed = ["spec/funcs.nlp"];
		expect(row.isConnected).toBe(true);
		expect(row.classList.contains("on")).toBe(true);
		expect(row.closest("li")!.classList.contains("changed")).toBe(true);
		el.selected = null;
		expect(row.classList.contains("on")).toBe(false);
	});
	it("keeps the marks when the rows are rebuilt", () => {
		const el = make();
		el.selected = "spec/funcs.nlp";
		el.sequence = `${SEQ}\n`;
		expect(el.querySelector('button[data-path="spec/funcs.nlp"]')!.classList.contains("on")).toBe(true);
	});
	it("offers revert only when asked to", () => {
		const el = make();
		expect(el.querySelector(".nlp-revert")).toBeNull();
		el.setAttribute("revertable", "");
		const reverted: string[] = [];
		el.addEventListener("nlp-revert", (e) => reverted.push(e.detail.path));
		el.querySelector<HTMLButtonElement>('li[data-path="spec/funcs.nlp"] .nlp-revert')!.click();
		expect(reverted).toEqual(["spec/funcs.nlp"]);
	});
	it("lists nothing under a heading of its own when told heading=\"\"", () => {
		document.body.innerHTML = '<nlp-sequence heading=""></nlp-sequence>';
		const el = document.body.firstElementChild as NlpSequence;
		el.files = FILES;
		el.sequence = SEQ;
		expect(el.querySelector("h3")).toBeNull();
		expect(el.querySelectorAll("li").length).toBe(4);
	});
	it("hides itself with nothing to list", () => {
		const el = document.createElement("nlp-sequence");
		document.body.append(el);
		expect(el.hidden).toBe(true);
	});
});

describe("<nlp-knowledge-base>", () => {
	it("lists the .dict and .kbb files, never the .kb files, with their sizes when known", () => {
		const el = document.createElement("nlp-knowledge-base") as NlpKnowledgeBase;
		el.files = [{ path: "kb/user/hier.kb", bytes: 33000 }, { path: "kb/user/colors.dict", bytes: 3000 }, { path: "kb/user/facts.kbb" }];
		document.body.append(el);
		expect(el.querySelector("h3")?.textContent).toBe("Knowledge base");
		expect(paths(el)).toEqual(["kb/user/colors.dict", "kb/user/facts.kbb"]);
		expect([...el.querySelectorAll(".nlp-name")].map((n) => n.textContent)).toEqual(["user/colors.dict", "user/facts.kbb"]);
		expect([...el.querySelectorAll(".nlp-size")].map((n) => n.textContent)).toEqual(["3 KB"]);
	});
	it("hides itself when the analyzer has only .kb files", () => {
		const el = document.createElement("nlp-knowledge-base");
		el.files = ["kb/user/hier.kb", "kb/user/word.kb"];
		document.body.append(el);
		expect(el.hidden).toBe(true);
	});
});
