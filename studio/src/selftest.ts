// The studio checking itself, in a real browser: `index.html?selftest`.
//
// scripts/selftest.py serves a build, opens it headless and waits for this to
// POST its results. Every check goes through the editor the way a person would
// -- a Monaco action, a provider, a marker -- so a pass means the grammar, the
// worker, the client and the editor all agree, not just that a request answered.
import { monaco } from "./monaco";
import { LANGUAGE_IDS } from "./highlight";
import type { Studio } from "./main";

interface Check { name: string; ok: boolean; got: unknown }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(get: () => T | Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
	const start = Date.now();
	let value = await get();
	while (!ok(value) && Date.now() - start < ms) {
		await wait(50);
		value = await get();
	}
	return value;
}

function positionOf(model: monaco.editor.ITextModel, text: string, offset = 1): monaco.Position {
	const match = model.findMatches(text, false, false, true, null, false)[0];
	if (!match) throw new Error(`"${text}" is not in ${model.uri.toString()}`);
	return new monaco.Position(match.range.startLineNumber, match.range.startColumn + offset);
}

export async function selfTest(studio: Studio): Promise<{ ok: boolean; checks: Check[] }> {
	const checks: Check[] = [];
	const check = (name: string, ok: boolean, got: unknown) => checks.push({ name, ok, got });

	try {
		check("the studio's own sample is listed", studio.analyzers.some((a) => a.name === "hello-studio"),
			studio.analyzers.map((a) => a.name));
		check("all seven NLP++ grammars are registered",
			LANGUAGE_IDS.every((id) => monaco.languages.getLanguages().some((l) => l.id === id)), LANGUAGE_IDS);

		const tokens = monaco.editor.tokenize('@CODE\nG("x") = 1; # a note\n@@CODE', "nlp").flat();
		const kinds = new Set(tokens.map((t) => t.type));
		check("NLP++ is tokenized by its grammar, not as plain text", kinds.size > 2, [...kinds].slice(0, 6));

		await studio.openAnalyzer("hello-studio");
		studio.openPath("spec/greeting.nlp");
		const greeting = studio.editor.getModel()!;

		studio.editor.setPosition(positionOf(greeting, "AddGreeting"));
		// A command (registerAction2), not an editor action, so getAction() does not find it.
		studio.editor.trigger("selftest", "editor.action.revealDefinition", null);
		const jumped = await until(() => studio.currentPath, (p) => p === "spec/funcs.nlp");
		check("go to definition opens the pass that declares the function", jumped === "spec/funcs.nlp", jumped);

		const hover = await studio.client.hover(greeting, positionOf(greeting, "phrasetext"));
		const hoverText = hover ? (hover.contents[0] as { value: string }).value : "";
		check("hover names a built-in, without the extension's command link",
			hoverText.includes("built-in") && !hoverText.includes("command:"), hoverText);

		// Inside @POST: code completion. (In @RULES the server offers rule keywords and concepts.)
		const inPost = positionOf(greeting, "single", 0);
		const completion = await studio.client.completion(greeting, inPost);
		check("completion in @POST offers the analyzer's own function",
			completion.suggestions.some((s) => s.label === "AddGreeting"), completion.suggestions.length);

		studio.openPath("spec/funcs.nlp");
		const symbols = await studio.client.symbols(studio.editor.getModel()!);
		const names = JSON.stringify(symbols);
		check("the outline lists the declared function", names.includes("AddGreeting"), symbols.map((s) => s.name));

		studio.openPath("spec/output.nlp");
		const output = studio.editor.getModel()!;
		const at = positionOf(output, "@CODE", 0);
		output.pushEditOperations([], [{
			range: new monaco.Range(at.lineNumber + 1, 1, at.lineNumber + 1, 1),
			text: "AddGreting(\"x\");\n",
		}], () => null);
		const markers = await until(() => monaco.editor.getModelMarkers({ resource: output.uri }),
			(m) => m.some((x) => x.message.includes("AddGreeting")));
		check("a misspelled call is flagged with the right name to use",
			markers.some((m) => m.message.includes("did you mean 'AddGreeting'")), markers.map((m) => m.message));

		const other = studio.analyzers.find((a) => a.origin === "template");
		if (other) {
			await studio.openAnalyzer(other.name);
			const gone = await until(() => studio.client.workspaceSymbols("AddGreeting"), (s) => s.length === 0);
			check("opening another analyzer replaces the files the server knows", gone.length === 0, gone);
			const kb = await until(() => studio.client.workspaceSymbols("AddUniqueCon"), (s) => s.length > 0);
			check("...and indexes the new analyzer's passes", kb.length > 0, `${other.name}: ${kb.length}`);
		}
	} catch (err) {
		check("the self test ran to the end", false, err instanceof Error ? err.message : String(err));
	}
	return { ok: checks.every((c) => c.ok), checks };
}
