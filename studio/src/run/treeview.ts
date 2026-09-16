// Parse trees in the editor: what a node covers, and where it came from.
//
// A run's trees open as read-only documents in the "tree" language, in the editor's full
// width -- they can be very large. Each tree document is tied to the run that wrote it: the
// input text exactly as it was run, and which spec/ file each pass number is. With that:
//
//   hover on a node line          the text the node covers, and what built it
//   go to definition (F12) on a   the rule's line in its pass file, when a rule built it;
//   node line                     otherwise the node's text, selected in the input
import { monaco } from "../monaco";
import { fileUri } from "../analyzers";
import { displayName, parseTreeLine, spanOf, utf16Offsets } from "./tree";

export interface TreeContext {
	analyzer: string;                      // the analyzer's name, for its files' URIs
	inputPath: string;                     // the input file the run read
	text: string;                          // that input, exactly as it was run
	passFile(pass: number): string | null; // the spec/ file of a pass number
}

interface Attached {
	context: TreeContext;
	offsets: number[];
}

const attached = new WeakMap<monaco.editor.ITextModel, Attached>();

export function attachTreeContext(model: monaco.editor.ITextModel, context: TreeContext): void {
	attached.set(model, { context, offsets: utf16Offsets(context.text) });
}

// The 1-based position of a UTF-16 offset in text with \n line endings.
export function positionAt(text: string, offset: number): { lineNumber: number; column: number } {
	let lineNumber = 1;
	let lineStart = 0;
	for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
		lineNumber++;
		lineStart = i + 1;
	}
	return { lineNumber, column: offset - lineStart + 1 };
}

function nodeAt(model: monaco.editor.ITextModel, position: monaco.IPosition) {
	const found = attached.get(model);
	const node = parseTreeLine(model.getLineContent(position.lineNumber));
	return found && node ? { ...found, node } : null;
}

const SNIPPET = 120;

export function treeHover(model: monaco.editor.ITextModel, position: monaco.IPosition): monaco.languages.Hover | null {
	const at = nodeAt(model, position);
	if (!at) return null;
	const { node, context, offsets } = at;
	const span = spanOf(node, offsets);
	const covered = span ? context.text.slice(span[0], span[1]) : "";
	const shown = covered.length > SNIPPET ? `${covered.slice(0, SNIPPET)}…` : covered;
	const file = node.pass > 0 ? context.passFile(node.pass) : null;
	const origin = file && node.line > 0
		? `Built by the rule at **${file.replace(/^spec\//, "")}:${node.line}** (pass ${node.pass}). Go to definition opens it.`
		: `${node.pass > 0 ? `From pass ${node.pass}. ` : ""}Go to definition selects its text in the input.`;
	return {
		range: new monaco.Range(position.lineNumber, 1, position.lineNumber, model.getLineMaxColumn(position.lineNumber)),
		contents: [
			{ value: `**${displayName(node.name)}** — ${node.type}, characters ${node.ustart}–${node.uend}` },
			{ value: covered ? `\`\`\`text\n${shown.replace(/```/g, "ˋˋˋ")}\n\`\`\`` : "_Covers no text._" },
			{ value: origin },
		],
	};
}

export function treeDefinition(model: monaco.editor.ITextModel, position: monaco.IPosition): monaco.languages.Location | null {
	const at = nodeAt(model, position);
	if (!at) return null;
	const { node, context, offsets } = at;
	const file = node.pass > 0 ? context.passFile(node.pass) : null;
	if (file && node.line > 0) {
		return { uri: monaco.Uri.parse(fileUri(context.analyzer, file)), range: new monaco.Range(node.line, 1, node.line, 1) };
	}
	const span = spanOf(node, offsets);
	if (!span) return null;
	const from = positionAt(context.text, span[0]);
	const to = positionAt(context.text, span[1]);
	return {
		uri: monaco.Uri.parse(fileUri(context.analyzer, context.inputPath)),
		range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
	};
}

export function installTreeFeatures(): monaco.IDisposable[] {
	return [
		monaco.languages.registerHoverProvider("tree", { provideHover: (model, position) => treeHover(model, position) }),
		monaco.languages.registerDefinitionProvider("tree", {
			provideDefinition: (model, position) => treeDefinition(model, position),
		}),
	];
}
