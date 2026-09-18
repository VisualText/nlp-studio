// Turning a run's result into what the try page's views take.
//
// PURE: no DOM, no fetch. The two translations here are easy to get quietly wrong --
// a tree list that loses its sizes, or a pass offered a tree it has no business with --
// and neither shows up as an error, only as a page that looks slightly off. So they
// live here with tests (test/try.test.ts) rather than inline in main.ts.

import { readOutput, type TreeFile as ViewTree } from "@visualtext/analyzer-views/rules";

import type { RunResult, RunStatus } from "../run/api";

// The run server calls a tree's size `size`; the views call it `bytes`. One of the two
// names has to be translated, and this is the only place that does it.
export function viewTrees(result: Pick<RunResult, "trees"> | null | undefined): ViewTree[] {
	return (result?.trees?.files ?? []).map((tree) => ({
		name: tree.name,
		pass: tree.pass,
		passName: tree.passName,
		bytes: tree.size,
	}));
}

// The trees that give a pass its two icons. final.tree was written after the last pass
// but belongs to none, so handing it to <nlp-sequence> would put the icons on whichever
// pass happened to be numbered null.
export function passTrees(trees: readonly ViewTree[]): ViewTree[] {
	return trees.filter((tree) => tree.pass !== null);
}

// How loudly to say what happened. A run that ran and found problems is the analyzer's
// news, not the page's; anything else is the page failing to do what was asked.
export function resultTone(status: RunStatus): "" | "warn" | "bad" {
	if (status === "ok") return "";
	return status === "failed" ? "warn" : "bad";
}

// What <nlp-values> lists, when the analyzer wrote an output.json at all. Most of
// VisualText's analyzers write .txt and .kbb files instead, and then there is nothing to
// list and the element hides itself.
//
// readOutput() answers { output } or { error }, while the element wants the parsed value
// itself -- handing it the wrapper would list a field called "output.greetings" instead
// of "greetings". An output.json that is not JSON is the analyzer saying something worth
// repeating, so it comes back as a sentence rather than being dropped.
export function valuesOutput(result: Pick<RunResult, "output"> | null | undefined):
	{ output: unknown; error: string | null } {
	const text = result?.output?.["output.json"];
	if (text === undefined) return { output: null, error: null };
	const read = readOutput(text);
	return "error" in read ? { output: null, error: read.error } : { output: read.output, error: null };
}
