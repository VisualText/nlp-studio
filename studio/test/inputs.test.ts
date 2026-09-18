import { describe, expect, it } from "vitest";

import { inputTexts } from "../src/try/inputs";

describe("inputTexts", () => {
	// corporate's input/, as the analyzers release has it.
	const CORPORATE = [
		"spec/analyzer.seq", "kb/user/hier.kb",
		"input/Samples/states.txt", "input/Dev/Sold.txt",
		"input/Samples/companies.txt", "input/Samples/cities.txt",
	];

	it("offers every file under input/, in path order, named without input/", () => {
		expect(inputTexts(CORPORATE, "input/Dev/Sold.txt").texts).toEqual([
			{ path: "input/Dev/Sold.txt", label: "Dev/Sold.txt" },
			{ path: "input/Samples/cities.txt", label: "Samples/cities.txt" },
			{ path: "input/Samples/companies.txt", label: "Samples/companies.txt" },
			{ path: "input/Samples/states.txt", label: "Samples/states.txt" },
		]);
	});

	it("starts on the text the build chose", () => {
		expect(inputTexts(CORPORATE, "input/Samples/cities.txt").start).toBe("input/Samples/cities.txt");
	});

	it("starts on the first when the chosen one is not there", () => {
		expect(inputTexts(CORPORATE, "input/gone.txt").start).toBe("input/Dev/Sold.txt");
		expect(inputTexts(CORPORATE, null).start).toBe("input/Dev/Sold.txt");
	});

	it("has one text for an analyzer with one, so the page need offer no choice", () => {
		const { texts, start } = inputTexts(["spec/analyzer.seq", "input/text.txt"], "input/text.txt");
		expect(texts).toHaveLength(1);
		expect(start).toBe("input/text.txt");
	});

	it("has none, and nothing to start on, for an analyzer with no input/", () => {
		expect(inputTexts(["spec/analyzer.seq", "spec/input.nlp"], null)).toEqual({ texts: [], start: null });
	});
});
