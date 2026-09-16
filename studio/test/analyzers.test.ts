import { describe, expect, it } from "vitest";
import { fileUri, pathOf, ROOT_URI } from "../src/analyzers";

describe("analyzer files as URIs", () => {
	it("puts every file under the one workspace folder", () => {
		expect(fileUri("hello-studio", "spec/funcs.nlp")).toBe(`${ROOT_URI}/hello-studio/spec/funcs.nlp`);
	});
	it("reads a path back, and nothing from another analyzer", () => {
		const uri = fileUri("hello-studio", "spec/funcs.nlp");
		expect(pathOf(uri, "hello-studio")).toBe("spec/funcs.nlp");
		expect(pathOf(uri, "hello")).toBeUndefined();
	});
});

// How passes and the knowledge base are listed is tested in ../analyzer-views.
