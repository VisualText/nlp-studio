import { describe, expect, it } from "vitest";
import { INPUT, MAX_TEXT, acceptInput, inputName, keepLink, parseOpenLink, takeLink } from "../src/handoff";

describe("parseOpenLink", () => {
	it("reads the analyzer a link names", () => {
		expect(parseOpenLink("?repo=VisaLinkAI/teg-analyzers&ref=develop&folder=resume-analyzer&handoff=1"))
			.toEqual({ repo: "VisaLinkAI/teg-analyzers", ref: "develop", folder: "resume-analyzer", handoff: true });
		expect(parseOpenLink("?repo=a/b")).toEqual({ repo: "a/b", ref: "", folder: "", handoff: false });
	});

	it("names nothing when the repository is missing or malformed", () => {
		expect(parseOpenLink("")).toBeNull();
		expect(parseOpenLink("?repo=notarepo")).toBeNull();
		expect(parseOpenLink("?repo=a/b&folder=../../etc")).toBeNull();
		expect(parseOpenLink("?repo=a/b&ref=bad ref")).toBeNull();
	});
});

describe("keepLink / takeLink", () => {
	it("keeps a link across the sign-in round trip, once", () => {
		const items = new Map<string, string>();
		const store = {
			setItem: (k: string, v: string) => void items.set(k, v),
			getItem: (k: string) => items.get(k) ?? null,
			removeItem: (k: string) => void items.delete(k),
		};
		keepLink({ repo: "a/b", ref: "main", folder: "x", handoff: true }, store);
		expect(takeLink(store)).toEqual({ repo: "a/b", ref: "main", folder: "x", handoff: true });
		expect(takeLink(store)).toBeNull();
	});
});

describe("inputName", () => {
	it("keeps a plain name and gives it .txt", () => {
		expect(inputName("resume__8f3a2c1e90.txt")).toBe("resume__8f3a2c1e90.txt");
		expect(inputName("case 12")).toBe("case_12.txt");
	});

	it("can never reach outside input/", () => {
		expect(inputName("../../spec/analyzer.seq")).toBe("analyzer.seq.txt");
		expect(inputName("..")).toBe("handed-in.txt");
		expect(inputName(undefined)).toBe("handed-in.txt");
	});
});

describe("acceptInput", () => {
	const opener = {};
	const allowed = ["https://admin.example.org"];
	const event = (over: Partial<{ data: unknown; origin: string; source: unknown }> = {}) => ({
		data: { type: INPUT, name: "r.txt", text: "Work Experience\r\nStaff Nurse" },
		origin: "https://admin.example.org",
		source: opener,
		...over,
	}) as unknown as MessageEvent;

	it("takes a text from the opener at an allowed origin", () => {
		expect(acceptInput(event(), opener, allowed)).toEqual({ name: "r.txt", text: "Work Experience\nStaff Nurse" });
	});

	it("refuses a text from another window, another origin, or no allowed origin at all", () => {
		expect(acceptInput(event({ source: {} }), opener, allowed)).toBeNull();
		expect(acceptInput(event({ origin: "https://evil.example" }), opener, allowed)).toBeNull();
		expect(acceptInput(event(), opener, [])).toBeNull();
		expect(acceptInput(event(), null, allowed)).toBeNull();
	});

	it("refuses what is not a text, and a text too large to be a document", () => {
		expect(acceptInput(event({ data: { type: "other", text: "x" } }), opener, allowed)).toBeNull();
		expect(acceptInput(event({ data: { type: INPUT, text: 42 } }), opener, allowed)).toBeNull();
		expect(acceptInput(event({ data: { type: INPUT, text: "x".repeat(MAX_TEXT + 1) } }), opener, allowed)).toBeNull();
	});
});
