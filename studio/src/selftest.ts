// The studio checking itself, in a real browser: `index.html?selftest`.
//
// scripts/selftest.py serves a build, opens it headless and waits for this to
// POST its results. Every check goes through the editor the way a person would
// -- a Monaco action, a provider, a marker, a click in the results -- so a pass
// means the grammar, the worker, the client, the run server and the editor all
// agree, not just that a request answered.
//
// `?selftest=run` adds the run checks; selftest.py asks for them when it has
// started a run server for the page.
import { strFromU8, unzipSync } from "fflate";
import { monaco } from "./monaco";
import { LANGUAGE_IDS } from "./highlight";
import { TREE_COLORS } from "./tokencolors";
import { DraftStore } from "./drafts";
import { recent } from "./github/api";
import { type Studio, RUN_MARKERS } from "./main";
import { treeHover } from "./run/treeview";

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

const rgbOf = (hex: string) =>
	`rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;

// What colour a token has in colorized HTML. Monaco writes a class (mtk7) per colour in the
// theme's map and a stylesheet to go with it, so the colour itself is in that sheet.
function colourOf(html: string, token: string): string {
	// A token's span may hold more than the word asked for: the tree grammar colours a node
	// name together with the indent in front of it.
	const cls = new RegExp(`class="(mtk\\d+)[^"]*">[^<]*${token}<`).exec(html)?.[1];
	if (!cls) return `"${token}" is not a token of its own`;
	for (const sheet of [...document.styleSheets]) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // another origin's stylesheet
		}
		for (const rule of [...rules]) {
			if (rule instanceof CSSStyleRule && rule.selectorText.split(",").some((s) => s.trim() === `.${cls}`)) {
				return rule.style.color;
			}
		}
	}
	return `no rule for .${cls}`;
}

function positionOf(model: monaco.editor.ITextModel, text: string, offset = 1): monaco.Position {
	const match = model.findMatches(text, false, false, true, null, false)[0];
	if (!match) throw new Error(`"${text}" is not in ${model.uri.toString()}`);
	return new monaco.Position(match.range.startLineNumber, match.range.startColumn + offset);
}

// Tell selftest.py how far the page has got, as it goes, so a hang says where it is.
export function progress(step: string): void {
	void fetch("selftest-progress", { method: "POST", body: step, keepalive: true }).catch(() => undefined);
}

export async function selfTest(studio: Studio, options: { run: boolean }): Promise<{ ok: boolean; checks: Check[] }> {
	const checks: Check[] = [];
	const check = (name: string, ok: boolean, got: unknown) => {
		checks.push({ name, ok, got });
		progress(`${ok ? "ok " : "BAD"} ${name}`);
	};

	try {
		check("the studio's own sample is listed", studio.analyzers.some((a) => a.name === "hello-studio"),
			studio.analyzers.map((a) => a.name));
		check("all seven NLP++ grammars are registered",
			LANGUAGE_IDS.every((id) => monaco.languages.getLanguages().some((l) => l.id === id)), LANGUAGE_IDS);

		const tokens = monaco.editor.tokenize('@CODE\nG("x") = 1; # a note\n@@CODE', "nlp").flat();
		const kinds = new Set(tokens.map((t) => t.type));
		check("NLP++ is tokenized by its grammar, not as plain text", kinds.size > 2, [...kinds].slice(0, 6));

		// A parse tree, coloured as the VS Code extension colours it: node names green,
		// offsets blue. Both come from the extension's own rules (tokencolors.ts).
		const coloured = await monaco.editor.colorize(
			"_ROOT [0,10,0,10,0,0,node,un]\n   _greeting [0,10,0,10,3,13,node,blt]\n      hello [0,4,0,4,1,0,alpha]\n",
			"tree", {});
		const nodeName = colourOf(coloured, "hello");
		const offset = colourOf(coloured, "13");
		check("a parse tree is coloured the way the NLP++ extension colours it",
			nodeName === rgbOf(TREE_COLORS.node)
			&& (offset === rgbOf(TREE_COLORS.numberLight) || offset === rgbOf(TREE_COLORS.numberDark)),
			{ nodeName, offset, wanted: TREE_COLORS });

		await studio.openAnalyzer("hello-studio");

		// The file list as the extension's ANALYZER SEQUENCE view: the heading, a DNA icon on
		// every rule pass, and the pass's comment on the mouse-over instead of under it.
		const headings = [...document.querySelectorAll<HTMLElement>("#files h3")].map((h) => h.textContent);
		const passButton = document.querySelector<HTMLButtonElement>('#files button[data-path="spec/greeting.nlp"]');
		const passRow = passButton?.closest(".file-row");
		check("the sequence is listed as in the extension: DNA icons, and the comment as a mouse-over",
			headings.includes("Analyzer Sequence") && !!passRow?.querySelector(".file-icon.dna svg")
			&& (passButton?.title.length ?? 0) > 0 && !passButton?.closest("li")?.querySelector("small"),
			{ headings, title: passButton?.title, icon: passRow?.querySelector(".file-icon")?.className });

		// In the DOM is not enough: the list's own rule for a span in a row once stretched the
		// icon across half the row and painted it muted, which hid the helix and pushed the
		// name off the left. So measure -- a small square, then the name hard against it.
		const iconBox = passRow?.querySelector(".file-icon")?.getBoundingClientRect();
		const nameBox = passButton?.getBoundingClientRect();
		const rowBox = passRow?.getBoundingClientRect();
		check("...the icon is a small square and the name starts right after it, against the left",
			!!iconBox && !!nameBox && !!rowBox && iconBox.width > 8 && iconBox.width < 20
			&& iconBox.left - rowBox.left < 6 && nameBox.left - iconBox.right < 10,
			{ icon: iconBox?.width, fromLeft: iconBox && rowBox && iconBox.left - rowBox.left,
				gap: nameBox && iconBox && nameBox.left - iconBox.right });

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

		await draftChecks(studio, check);
		await githubChecks(studio, check, options.run);
		await commitChecks(studio, check);
		if (options.run) await runChecks(studio, check);
	} catch (err) {
		check("the self test ran to the end", false, err instanceof Error ? err.message : String(err));
	}
	return { ok: checks.every((c) => c.ok), checks };
}

async function draftChecks(studio: Studio, check: (name: string, ok: boolean, got: unknown) => void): Promise<void> {
	// The language-feature checks above edited output.nlp; start from the sample as shipped.
	studio.forgetDrafts("hello-studio");
	await studio.openAnalyzer("hello-studio");
	check("the sample opens with nothing changed", studio.changedPaths().length === 0, studio.changedPaths());

	studio.openPath("spec/greeting.nlp");
	const model = studio.editor.getModel()!;
	const edited = `${model.getValue()}\n# a line written in the self test\n`;
	model.setValue(edited);
	studio.flushDrafts();
	const stored = DraftStore.browser().load("hello-studio");
	check("an edit is kept in this browser", stored?.files["spec/greeting.nlp"] === edited, Object.keys(stored?.files ?? {}));
	const row = document.querySelector('#files button[data-path="spec/greeting.nlp"]')?.closest("li");
	check("...and its file is marked changed", row?.classList.contains("changed") === true, row?.className);

	await studio.openAnalyzer("hello-studio");
	studio.openPath("spec/greeting.nlp");
	check("opening the analyzer again brings the edit back", studio.editor.getModel()!.getValue() === edited,
		studio.changedPaths());

	const entries = unzipSync(studio.analyzerZip());
	check("download zips the analyzer as its folder",
		["hello-studio/spec/analyzer.seq", "hello-studio/kb/user/hier.kb", "hello-studio/input/hello.txt"]
			.every((p) => p in entries), Object.keys(entries));
	check("...with the edit in it", strFromU8(entries["hello-studio/spec/greeting.nlp"] ?? new Uint8Array()) === edited, null);

	studio.revert("spec/greeting.nlp");
	check("revert restores the file and forgets the draft",
		studio.changedPaths().length === 0 && DraftStore.browser().load("hello-studio") === null, studio.changedPaths());
}

// Against the stand-in GitHub that selftest.py starts, holding the sample twice:
// in samples/hello-studio, and deeper, in nested/deep/hello.
async function githubChecks(studio: Studio, check: (name: string, ok: boolean, got: unknown) => void,
	withRun: boolean): Promise<void> {
	if (!studio.account?.github) return; // this server has no GitHub: nothing to check
	check("the page knows who GitHub says you are", studio.account.signedIn && !!studio.account.login, studio.account);

	progress("opening the GitHub dialog");
	await studio.showGitHubDialog();
	const repos = [...document.querySelectorAll<HTMLOptionElement>("#github-repo option")].map((o) => o.value);
	check("Open from GitHub lists the repositories you can reach", repos.includes("acme/analyzers"), repos);

	progress("listing the analyzers in acme/analyzers");
	await studio.listGitHubAnalyzers("acme/analyzers", "main");
	const buttons = [...document.querySelectorAll<HTMLButtonElement>("#github-analyzers button")];
	const folders = buttons.map((b) => b.dataset.folder);
	check("...and the analyzers in one, wherever they sit",
		folders.includes("samples/hello-studio") && folders.includes("nested/deep/hello"), folders);

	buttons.find((b) => b.dataset.folder === "nested/deep/hello")?.click();
	const opened = await until(() => studio.current?.source?.folder, (f) => f === "nested/deep/hello");
	check("clicking one opens it from GitHub", opened === "nested/deep/hello" && !(document.getElementById("github-dialog") as HTMLDialogElement).open,
		studio.current?.name);
	check("...with its passes, knowledge base and input", studio.passList.some((p) => p.name === "greeting")
		&& studio.current!.files.includes("kb/user/hier.kb") && studio.inputPath === "input/hello.txt", studio.current?.files);
	const kbListed = [...document.querySelectorAll<HTMLElement>("#files button[data-path]")]
		.map((b) => b.dataset.path!).filter((p) => p.startsWith("kb/"));
	check("the knowledge base lists the analyzer's .dict and .kbb files, not the engine's .kb files",
		kbListed.includes("kb/user/greetings.dict") && !kbListed.some((p) => p.endsWith(".kb")), kbListed);
	check("...and it is remembered for next time", recent().some((r) => r.repo === "acme/analyzers" && r.folder === "nested/deep/hello"),
		recent());

	if (withRun) {
		progress("running the analyzer opened from GitHub");
		const result = await studio.run();
		let greetings: unknown;
		try {
			greetings = JSON.parse(result.output?.["output.json"] ?? "null")?.greetings;
		} catch {
			greetings = undefined;
		}
		check("an analyzer opened from GitHub runs", result.status === "ok" && greetings === 3,
			{ status: result.status, message: result.message, greetings });
	}
}

// Against the stand-in GitHub again: commit the analyzer githubChecks opened.
async function commitChecks(studio: Studio, check: (name: string, ok: boolean, got: unknown) => void): Promise<void> {
	const source = studio.current?.source;
	if (!studio.account?.github || !source) return;
	const commitButton = document.getElementById("commit") as HTMLButtonElement;
	// `hidden` may also be "until-found" (TypeScript's DOM types), so compare, do not pass it on.
	check("with nothing changed there is no Commit button", commitButton.hidden === true, commitButton.hidden);

	studio.openPath("spec/greeting.nlp");
	const model = studio.editor.getModel()!;
	const edited = `${model.getValue()}# changed in the self test\n`;
	model.setValue(edited);
	studio.flushDrafts();
	check("changing an analyzer from GitHub shows Commit", !commitButton.hidden, commitButton.hidden);

	studio.showCommitDialog();
	const listed = [...document.querySelectorAll("#commit-files li")].map((li) => li.textContent);
	check("the commit dialog lists the changed file where it is in the repository",
		listed.length === 1 && listed[0] === `${source.folder}/spec/greeting.nlp`, listed);
	(document.getElementById("commit-dialog") as HTMLDialogElement).close();

	progress("committing to the stand-in GitHub");
	const first = await studio.commitChanges("Change the greeting from the self test");
	check("a commit goes on a new branch, with a pull request",
		first.branch.startsWith("nlp-studio/selftest/hello-") && first.pullRequest?.number === 1, first);
	studio.openPath("spec/greeting.nlp");
	check("...and the analyzer reopens from that branch, holding the edit, with nothing left to commit",
		studio.current?.source?.ref === first.branch && studio.current.source.commit === first.commit
		&& studio.editor.getModel()!.getValue() === edited && studio.changedPaths().length === 0 && commitButton.hidden === true,
		{ ref: studio.current?.source?.ref, changed: studio.changedPaths() });

	const reopened = studio.editor.getModel()!;
	reopened.setValue(`${reopened.getValue()}# and once more\n`);
	progress("committing again to the same branch");
	const second = await studio.commitChanges("Change it once more");
	check("committing again adds to the same branch and pull request",
		second.branch === first.branch && second.pullRequest?.number === first.pullRequest?.number
		&& second.commit !== first.commit, second);
}

async function runChecks(studio: Studio, check: (name: string, ok: boolean, got: unknown) => void): Promise<void> {
	studio.forgetDrafts("hello-studio");
	await studio.openAnalyzer("hello-studio");
	const result = await studio.run();
	let greetings: unknown;
	try {
		greetings = JSON.parse(result.output?.["output.json"] ?? "null")?.greetings;
	} catch {
		greetings = undefined;
	}
	check("the run server runs the sample to its output", result.status === "ok" && greetings === 3,
		{ status: result.status, message: result.message, greetings });

	// The Output tab lists what the run wrote, by name, and opens a file in the editor.
	studio.panel.showTab("output");
	const inPanel = [...document.querySelectorAll<HTMLElement>("#results .run-file")].map((b) => b.dataset.output!);
	check("the Output tab lists the files the run wrote", inPanel.includes("output.json"), inPanel);
	document.querySelector<HTMLButtonElement>('#results .run-file[data-output="output.json"]')?.click();
	check("...and clicking one there opens it in the editor", studio.currentOutput === "output.json", studio.currentOutput);

	// What the analyzer wrote is listed like the extension's OUTPUT FILES view, and opens in
	// the editor rather than being dumped into the panel.
	const outputs = [...document.querySelectorAll<HTMLElement>("#files button[data-output]")].map((b) => b.dataset.output!);
	const jsonIcon = document.querySelector('#files button[data-output="output.json"]')
		?.closest(".file-row")?.querySelector(".file-icon.json svg");
	check("the files the run wrote are listed with their icons", outputs.includes("output.json") && !!jsonIcon, outputs);

	document.querySelector<HTMLButtonElement>('#files button[data-output="output.json"]')?.click();
	const openedOutput = studio.editor.getModel();
	check("...and clicking one opens it in the editor, read-only",
		studio.currentOutput === "output.json" && (openedOutput?.getValue().includes("greetings") ?? false)
		&& studio.editor.getOption(monaco.editor.EditorOption.readOnly),
		{ output: studio.currentOutput, uri: openedOutput?.uri.toString() });

	const listed = () => [...document.querySelectorAll<HTMLElement>("#files button[data-tree]")].map((b) => b.dataset.tree!);
	check("without Debug, the file list offers only the final parse tree", JSON.stringify(listed()) === '["final.tree"]', listed());

	progress("opening the final parse tree");
	document.querySelector<HTMLButtonElement>('#files button[data-tree="final.tree"]')?.click();
	const tree = await until(() => studio.editor.getModel(), (m) => m?.getLanguageId() === "tree");
	const greetingLines = tree ? tree.findMatches("_greeting [", false, false, true, null, false) : [];
	check("the final parse tree opens in the editor, read-only, with the three greetings",
		studio.currentTree === "final.tree" && studio.currentPath === undefined && greetingLines.length === 3
		&& studio.editor.getOption(monaco.editor.EditorOption.readOnly),
		{ tree: studio.currentTree, language: tree?.getLanguageId(), greetings: greetingLines.length });

	if (tree && greetingLines.length) {
		const hover = treeHover(tree, greetingLines[0].range.getStartPosition());
		const hoverText = hover?.contents.map((c) => c.value).join("\n") ?? "";
		check("hover on a tree node shows the text it covers", hoverText.includes("hello world"), hoverText);

		studio.editor.setPosition(greetingLines[0].range.getStartPosition());
		studio.editor.trigger("selftest", "editor.action.revealDefinition", null);
		await until(() => studio.currentPath, (p) => p === "spec/greeting.nlp");
		const position = studio.editor.getPosition();
		const ruleLine = position && studio.currentPath ? studio.editor.getModel()!.getLineContent(position.lineNumber) : "";
		check("go to definition on a node opens the rule that built it",
			studio.currentPath === "spec/greeting.nlp" && ruleLine.includes("_greeting"), { path: studio.currentPath, ruleLine });
	}

	await studio.openTree("final.tree");
	const token = tree?.findMatches("world [", false, false, true, null, false)[0];
	if (token) {
		studio.editor.setPosition(token.range.getStartPosition());
		studio.editor.trigger("selftest", "editor.action.revealDefinition", null);
		await until(() => studio.currentPath, (p) => p === "input/hello.txt");
	}
	const input = studio.currentPath === "input/hello.txt" ? studio.editor.getModel() : null;
	const selected = input ? input.getValueInRange(studio.editor.getSelection()!) : "";
	check("go to definition on a token selects its text in the input", selected === "world",
		{ path: studio.currentPath, selected });

	progress("running with Debug");
	const debug = document.getElementById("debug") as HTMLInputElement;
	debug.checked = true;
	const debugged = await studio.run();
	debug.checked = false;
	const names = listed();
	check("with Debug, the file list offers the tree after every pass as well",
		debugged.status === "ok" && names.includes("final.tree") && names.includes("ana002.tree") && names.includes("ana003.tree"), names);
	const treeText = async (name: string) => (await studio.openTree(name)) ? studio.editor.getModel()!.getValue() : null;
	// Pass 1 tokenizes; pass 3 (greeting) builds the greetings.
	const afterOne = await treeText("ana001.tree");
	const afterThree = await treeText("ana003.tree");
	check("...and the greetings appear in the tree after the pass that builds them, not before",
		!!afterOne?.includes("world [") && !afterOne.includes("_greeting") && !!afterThree?.includes("_greeting"),
		{ afterOne: afterOne?.slice(0, 200), afterThree: afterThree?.length, path: document.getElementById("path")?.textContent });

	studio.openPath("spec/output.nlp");
	const output = studio.editor.getModel()!;
	output.setValue("@CODE\nNoSuchFunction(1);\n@@CODE\n");
	const failed = await studio.run();
	const problem = failed.problems?.find((p) => p.message.includes("Unknown fn"));
	check("a run error names its pass file and line", problem?.file === "spec/output.nlp" && problem.line === 2,
		{ status: failed.status, message: failed.message, ms: failed.ms, problems: failed.problems });
	const runMarkers = monaco.editor.getModelMarkers({ owner: RUN_MARKERS, resource: output.uri });
	check("...and marks that line in the editor", runMarkers.some((m) => m.startLineNumber === 2),
		runMarkers.map((m) => m.startLineNumber));
}
