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

describe("<nlp-output>", () => {
	it("lists what the run wrote by name, with icons and sizes, and says which was clicked", () => {
		const el = document.createElement("nlp-output");
		el.files = [{ path: "output.json", bytes: 2048 }, { path: "err.log" }];
		document.body.append(el);
		expect(el.querySelector("h3")?.textContent).toBe("Output");
		expect(paths(el)).toEqual(["err.log", "output.json"]);
		expect([...el.querySelectorAll(".nlp-icon")].map((i) => i.classList[1])).toEqual(["log", "json"]);
		expect([...el.querySelectorAll(".nlp-size")].map((n) => n.textContent)).toEqual(["2 KB"]);
		const opened: string[] = [];
		el.addEventListener("nlp-open", (e) => opened.push(e.detail.path));
		el.querySelector<HTMLButtonElement>('button[data-path="output.json"]')!.click();
		el.selected = "output.json";
		expect(opened).toEqual(["output.json"]);
		expect(el.querySelector('button[data-path="output.json"]')!.classList.contains("on")).toBe(true);
	});
	it("hides itself when the run wrote nothing", () => {
		const el = document.createElement("nlp-output");
		el.files = [];
		document.body.append(el);
		expect(el.hidden).toBe(true);
	});
});

describe("<nlp-trees>", () => {
	it("lists the final tree, then the tree after each pass, each with when it was written", () => {
		const el = document.createElement("nlp-trees");
		el.trees = [{ name: "ana001.tree", pass: 1, passName: "tokenize", bytes: 3000 }, { name: "final.tree", pass: null }];
		document.body.append(el);
		expect(el.querySelector("h3")?.textContent).toBe("Parse trees");
		expect(paths(el)).toEqual(["final.tree", "ana001.tree"]);
		expect([...el.querySelectorAll(".nlp-name")].map((n) => n.textContent)).toEqual(["final", "1 tokenize"]);
		expect([...el.querySelectorAll(".nlp-note")].map((n) => n.textContent)).toEqual(["after the last pass", "after pass 1 · 3 KB"]);
		expect(el.querySelector(".nlp-name")?.getAttribute("title")).toBe("Open the final parse tree");
	});
	it("says which trees were too large to keep", () => {
		const el = document.createElement("nlp-trees");
		el.trees = [{ name: "final.tree", pass: null }];
		el.skipped = ["ana007.tree"];
		document.body.append(el);
		expect(el.querySelector(".skipped .nlp-note")?.textContent).toBe("Too large to keep: ana007.tree");
	});
});

describe("<nlp-code>", () => {
	const until = async (check: () => boolean) => {
		for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
		return check();
	};
	const colours = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(".coloured span")]
		.map((s) => [s.textContent, s.style.getPropertyValue("--shiki-light").toLowerCase()]);

	it("shows the text plain at once, then coloured by the file's grammar", async () => {
		const el = document.createElement("nlp-code");
		el.path = "output/final.tree";
		el.text = "_ROOT [0,11]\n   _greeting [0,10]";
		document.body.append(el);
		expect(el.querySelector("pre")?.textContent).toBe("_ROOT [0,11]\n   _greeting [0,10]");
		expect(await until(() => !!el.querySelector(".coloured"))).toBe(true);
		expect(el.querySelector("pre")?.textContent).toBe("_ROOT [0,11]\n   _greeting [0,10]");
		// The extension's own tree colours, not the stock theme's: offsets blue.
		expect(colours(el)).toContainEqual(["0", "#5596f0"]);
	}, 20000);
	it("leaves a file that is not NLP++ plain, and never reads the text as HTML", async () => {
		const el = document.createElement("nlp-code");
		el.path = "notes.md";
		el.text = "<b>not bold</b>";
		document.body.append(el);
		await new Promise((r) => setTimeout(r, 300));
		expect(el.querySelector(".coloured")).toBeNull();
		expect(el.querySelector("b")).toBeNull();
		expect(el.textContent).toBe("<b>not bold</b>");
	});
	it("takes its grammar from the language attribute over the path", async () => {
		const el = document.createElement("nlp-code");
		el.setAttribute("language", "nlp");
		el.path = "notes.md";
		el.text = "@CODE\nL(\"x\") = 1;\n@@CODE";
		document.body.append(el);
		expect(el.language).toBe("nlp");
		expect(await until(() => !!el.querySelector(".coloured"))).toBe(true);
	}, 20000);
});

describe("<nlp-code> marks a line", () => {
	it("marks the line asked for, without changing the text", () => {
		const el = document.createElement("nlp-code");
		el.path = "notes.md";
		el.text = "one\ntwo\n\nfour";
		el.line = 2;
		document.body.append(el);
		const lines = [...el.querySelectorAll(".nlp-line")];
		expect(lines.map((l) => l.textContent)).toEqual(["one", "two", "", "four"]);
		expect(lines.map((l) => l.classList.contains("on"))).toEqual([false, true, false, false]);
		expect(el.textContent).toBe("one\ntwo\n\nfour");
		el.line = null;
		expect(el.querySelector(".nlp-line.on")).toBeNull();
	});
});

describe("<nlp-log>", () => {
	const make = () => {
		const el = document.createElement("nlp-log");
		el.problems = [
			{ file: "spec/output.nlp", pass: 4, line: 2, message: "Unknown fn/action name=X" },
			{ file: null, pass: 0, line: 0, message: "Errors in loading analyzer." },
		];
		el.lines = "4 2 [Unknown fn/action name=X]\n\n0 0 [Errors in loading analyzer.]";
		document.body.append(el);
		return el;
	};

	it("lists each problem by where it is, then the log's lines", () => {
		const el = make();
		expect(el.querySelector("h3")?.textContent).toBe("Log");
		expect([...el.querySelectorAll(".nlp-where")].map((w) => w.textContent)).toEqual(["spec/output.nlp:2", "analyzer"]);
		expect(el.querySelector(".nlp-log-lines")?.textContent)
			.toBe("4 2 [Unknown fn/action name=X]\n0 0 [Errors in loading analyzer.]");
	});
	it("opens a problem's file at its line, and offers nothing to open for one without a file", () => {
		const el = make();
		const opened: [string, number | undefined][] = [];
		el.addEventListener("nlp-open", (e) => opened.push([e.detail.path, e.detail.line]));
		el.querySelector<HTMLButtonElement>('button[data-path="spec/output.nlp"]')!.click();
		expect(opened).toEqual([["spec/output.nlp", 2]]);
		expect(el.querySelectorAll("button.nlp-problem-row").length).toBe(1);
	});
	it("hides itself with nothing to show", () => {
		const el = document.createElement("nlp-log");
		el.problems = [];
		el.lines = "\n";
		document.body.append(el);
		expect(el.hidden).toBe(true);
	});
});
