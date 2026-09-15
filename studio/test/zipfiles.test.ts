import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { safeFolder, zipAnalyzer } from "../src/zipfiles";

describe("zipAnalyzer", () => {
	it("puts the analyzer's files under one folder named after it", () => {
		const zip = zipAnalyzer("hello-studio", [
			["spec/analyzer.seq", "tokenize\tnil\n"],
			["kb/user/hier.kb", "add root\n"],
			["input/hello.txt", "héllo 😀\n"],
		]);
		const entries = unzipSync(zip);
		expect(Object.keys(entries).sort()).toEqual(
			["hello-studio/input/hello.txt", "hello-studio/kb/user/hier.kb", "hello-studio/spec/analyzer.seq"]);
		expect(strFromU8(entries["hello-studio/input/hello.txt"])).toBe("héllo 😀\n");
	});

	it("names the folder so every system accepts it", () => {
		expect(safeFolder("Date and Times")).toBe("Date and Times");
		expect(safeFolder('a/b\\c:d*e?"f<g>h|i')).toBe("a-b-c-d-e-f-g-h-i");
		expect(safeFolder(" .hidden. ")).toBe("hidden");
		expect(safeFolder("...")).toBe("analyzer");
	});
});
