// A small LSP client for Monaco, over the NLP++ language server in a Web Worker.
//
// WHY NOT monaco-languageclient. It is the general answer and it works by
// running a large part of VS Code's workbench inside the page (the
// @codingame/monaco-vscode-api stack, dozens of packages). This editor needs one
// language and a dozen requests, so it maps them itself: each Monaco provider
// below sends one LSP request and converts the answer (convert.ts, tested).
//
// FILES. The server indexes what the page sends with nlp/workspaceFiles, all
// under one workspace folder (analyzers.ts ROOT_URI). Opening a document tells it
// the text is being edited; an edit is sent in full and "saved" after a pause, so
// the cross-pass index sees new declarations without anyone pressing save.
import {
	BrowserMessageReader, BrowserMessageWriter, createMessageConnection, type MessageConnection,
} from "vscode-jsonrpc/browser";
import type {
	CodeAction, CompletionItem, CompletionList, DocumentHighlight, DocumentSymbol, FoldingRange,
	Hover, Location, LocationLink, PublishDiagnosticsParams, SignatureHelp, SymbolInformation,
	TextEdit, WorkspaceEdit, Range as LspRange,
} from "vscode-languageserver-protocol";
import { monaco } from "../monaco";
import { ROOT_URI } from "../analyzers";
import {
	completionKindName, hoverMarkdown, markerSeverity, monacoSymbolKind, servedByLanguageServer,
	toLspPosition, toLspRange, toMonacoRange, withoutCommandLinks,
} from "./convert";

type Model = monaco.editor.ITextModel;
type Position = monaco.Position;

export const WORKSPACE_FILES = "nlp/workspaceFiles";
const MARKER_OWNER = "nlp++";
const SAVE_AFTER_MS = 600;

interface Opened {
	version: number;
	listener: monaco.IDisposable;
	save?: ReturnType<typeof setTimeout>;
}

function locations(result: Location | Location[] | LocationLink[] | null): monaco.languages.Location[] {
	const list = !result ? [] : Array.isArray(result) ? result : [result];
	return list.map((l) => "targetUri" in l
		? { uri: monaco.Uri.parse(l.targetUri), range: toMonacoRange(l.targetSelectionRange) }
		: { uri: monaco.Uri.parse(l.uri), range: toMonacoRange(l.range) });
}

function textEdits(edits: TextEdit[] | null): monaco.languages.TextEdit[] {
	return (edits ?? []).map((e) => ({ range: toMonacoRange(e.range), text: e.newText }));
}

function workspaceEdit(edit: WorkspaceEdit | null | undefined): monaco.languages.WorkspaceEdit {
	const edits: monaco.languages.IWorkspaceTextEdit[] = [];
	for (const [uri, list] of Object.entries(edit?.changes ?? {})) {
		for (const e of list) {
			edits.push({ resource: monaco.Uri.parse(uri), versionId: undefined,
				textEdit: { range: toMonacoRange(e.range), text: e.newText } });
		}
	}
	return { edits };
}

function documentSymbol(s: DocumentSymbol): monaco.languages.DocumentSymbol {
	return {
		name: s.name, detail: s.detail ?? "", kind: monacoSymbolKind(s.kind), tags: [],
		range: toMonacoRange(s.range), selectionRange: toMonacoRange(s.selectionRange),
		children: (s.children ?? []).map(documentSymbol),
	};
}

const markdown = (value: string | { value: string } | undefined) =>
	value === undefined ? undefined : { value: typeof value === "string" ? value : value.value };

export class NlpLanguageClient {
	private readonly connection: MessageConnection;
	private readonly opened = new Map<string, Opened>();

	constructor(workerUrl: string) {
		// A classic worker: the server bundle is a plain script, not a module.
		const worker = new Worker(workerUrl);
		this.connection = createMessageConnection(new BrowserMessageReader(worker), new BrowserMessageWriter(worker));
		this.connection.onNotification("textDocument/publishDiagnostics",
			(p: PublishDiagnosticsParams) => this.showDiagnostics(p));
		this.connection.onNotification("nlp/telemetry", () => { /* the extension records these; not here */ });
		this.connection.listen();
	}

	async start(): Promise<void> {
		await this.connection.sendRequest("initialize", {
			processId: null,
			rootUri: null,
			capabilities: {
				textDocument: {
					synchronization: { didSave: true },
					hover: { contentFormat: ["markdown", "plaintext"] },
					completion: { completionItem: { documentationFormat: ["markdown", "plaintext"] } },
					publishDiagnostics: {},
				},
			},
			workspaceFolders: [{ uri: ROOT_URI, name: "analyzers" }],
		});
		await this.connection.sendNotification("initialized", {});
	}

	// Everything the server indexes is replaced by these: another analyzer was opened.
	async setFiles(files: { uri: string; text: string }[]): Promise<void> {
		for (const uri of [...this.opened.keys()]) this.close(uri);
		await this.connection.sendNotification(WORKSPACE_FILES, { replace: true, files });
	}

	// Start editing a model. Only rule files go to the server; the rest are coloured, not served.
	open(model: Model, path: string): void {
		const uri = model.uri.toString();
		if (!servedByLanguageServer(path) || this.opened.has(uri)) return;
		void this.connection.sendNotification("textDocument/didOpen",
			{ textDocument: { uri, languageId: "nlp", version: 1, text: model.getValue() } });
		const state: Opened = { version: 1, listener: { dispose() {} } };
		state.listener = model.onDidChangeContent(() => {
			state.version += 1;
			void this.connection.sendNotification("textDocument/didChange", {
				textDocument: { uri, version: state.version }, contentChanges: [{ text: model.getValue() }],
			});
			clearTimeout(state.save);
			state.save = setTimeout(() => {
				void this.connection.sendNotification("textDocument/didSave", { textDocument: { uri } });
			}, SAVE_AFTER_MS);
		});
		this.opened.set(uri, state);
	}

	close(uri: string): void {
		const state = this.opened.get(uri);
		if (!state) return;
		state.listener.dispose();
		clearTimeout(state.save);
		this.opened.delete(uri);
		void this.connection.sendNotification("textDocument/didClose", { textDocument: { uri } });
	}

	private request<R>(method: string, params: unknown): Promise<R> {
		return this.connection.sendRequest(method, params) as Promise<R>;
	}

	private at(model: Model, position: Position) {
		return { textDocument: { uri: model.uri.toString() }, position: toLspPosition(position) };
	}

	async hover(model: Model, position: Position): Promise<monaco.languages.Hover | null> {
		const h = await this.request<Hover | null>("textDocument/hover", this.at(model, position));
		const value = h ? withoutCommandLinks(hoverMarkdown(h.contents as never)) : "";
		return value ? { contents: [{ value }], range: h?.range ? toMonacoRange(h.range) : undefined } : null;
	}

	async definition(model: Model, position: Position): Promise<monaco.languages.Location[]> {
		return locations(await this.request("textDocument/definition", this.at(model, position)));
	}

	async references(model: Model, position: Position, includeDeclaration: boolean): Promise<monaco.languages.Location[]> {
		return locations(await this.request("textDocument/references",
			{ ...this.at(model, position), context: { includeDeclaration } }));
	}

	async highlights(model: Model, position: Position): Promise<monaco.languages.DocumentHighlight[]> {
		const list = await this.request<DocumentHighlight[] | null>("textDocument/documentHighlight", this.at(model, position));
		return (list ?? []).map((h) => ({ range: toMonacoRange(h.range), kind: monaco.languages.DocumentHighlightKind.Text }));
	}

	async symbols(model: Model): Promise<monaco.languages.DocumentSymbol[]> {
		const list = await this.request<DocumentSymbol[] | null>("textDocument/documentSymbol",
			{ textDocument: { uri: model.uri.toString() } });
		return (list ?? []).map(documentSymbol);
	}

	async workspaceSymbols(query: string): Promise<string[]> {
		const list = await this.request<SymbolInformation[] | null>("workspace/symbol", { query });
		return (list ?? []).map((s) => s.name);
	}

	async completion(model: Model, position: Position): Promise<monaco.languages.CompletionList> {
		const result = await this.request<CompletionItem[] | CompletionList | null>("textDocument/completion", this.at(model, position));
		const items = Array.isArray(result) ? result : result?.items ?? [];
		const word = model.getWordUntilPosition(position);
		const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
		return {
			suggestions: items.map((i) => ({
				label: i.label,
				kind: monaco.languages.CompletionItemKind[completionKindName(i.kind)],
				detail: i.detail,
				documentation: markdown(i.documentation as never),
				insertText: i.insertText ?? i.label,
				range,
			})),
		};
	}

	async signature(model: Model, position: Position): Promise<monaco.languages.SignatureHelpResult | null> {
		const help = await this.request<SignatureHelp | null>("textDocument/signatureHelp", this.at(model, position));
		if (!help?.signatures.length) return null;
		return {
			value: {
				signatures: help.signatures.map((s) => ({
					label: s.label,
					documentation: markdown(s.documentation as never),
					parameters: (s.parameters ?? []).map((p) => ({ label: p.label as string })),
				})),
				activeSignature: help.activeSignature ?? 0,
				activeParameter: help.activeParameter ?? 0,
			},
			dispose() {},
		};
	}

	async folding(model: Model): Promise<monaco.languages.FoldingRange[]> {
		const list = await this.request<FoldingRange[] | null>("textDocument/foldingRange",
			{ textDocument: { uri: model.uri.toString() } });
		return (list ?? []).map((r) => ({
			start: r.startLine + 1, end: r.endLine + 1,
			kind: r.kind === "comment" ? monaco.languages.FoldingRangeKind.Comment : monaco.languages.FoldingRangeKind.Region,
		}));
	}

	async format(model: Model, options: monaco.languages.FormattingOptions, range?: monaco.IRange): Promise<monaco.languages.TextEdit[]> {
		const textDocument = { uri: model.uri.toString() };
		const opts = { tabSize: options.tabSize, insertSpaces: options.insertSpaces };
		return textEdits(range
			? await this.request("textDocument/rangeFormatting", { textDocument, range: toLspRange(range), options: opts })
			: await this.request("textDocument/formatting", { textDocument, options: opts }));
	}

	async prepareRename(model: Model, position: Position): Promise<monaco.languages.RenameLocation & monaco.languages.Rejection> {
		try {
			const r = await this.request<LspRange | { range: LspRange; placeholder: string } | null>(
				"textDocument/prepareRename", this.at(model, position));
			if (!r) return { range: new monaco.Range(1, 1, 1, 1), text: "", rejectReason: "You cannot rename this element." };
			const range = toMonacoRange("start" in r ? r : r.range);
			return { range, text: "placeholder" in r ? r.placeholder : model.getValueInRange(range) };
		} catch (err) {
			return { range: new monaco.Range(1, 1, 1, 1), text: "", rejectReason: (err as Error).message };
		}
	}

	async rename(model: Model, position: Position, newName: string): Promise<monaco.languages.WorkspaceEdit> {
		return workspaceEdit(await this.request("textDocument/rename", { ...this.at(model, position), newName }));
	}

	async codeActions(model: Model, range: monaco.IRange, markers: monaco.editor.IMarkerData[]): Promise<monaco.languages.CodeActionList> {
		const diagnostics = markers.map((m) => ({
			range: toLspRange(m), message: m.message, source: m.source,
			code: typeof m.code === "string" ? m.code : m.code?.value,
		}));
		const actions = await this.request<CodeAction[] | null>("textDocument/codeAction",
			{ textDocument: { uri: model.uri.toString() }, range: toLspRange(range), context: { diagnostics } });
		return {
			actions: (actions ?? []).map((a) => ({
				title: a.title, kind: a.kind, isPreferred: a.isPreferred, diagnostics: markers, edit: workspaceEdit(a.edit),
			})),
			dispose() {},
		};
	}

	private showDiagnostics(p: PublishDiagnosticsParams): void {
		const model = monaco.editor.getModel(monaco.Uri.parse(p.uri));
		if (!model) return;
		monaco.editor.setModelMarkers(model, MARKER_OWNER, p.diagnostics.map((d) => ({
			...toMonacoRange(d.range),
			message: typeof d.message === "string" ? d.message : d.message.value,
			severity: markerSeverity(d.severity),
			source: d.source,
			code: d.code === undefined ? undefined : String(d.code),
		})));
	}
}

// Every Monaco provider for NLP++ rule files, each a thin call into the client.
export function installLanguageFeatures(client: NlpLanguageClient): monaco.IDisposable[] {
	const id = "nlp";
	const L = monaco.languages;
	return [
		L.registerHoverProvider(id, { provideHover: (m, p) => client.hover(m, p) }),
		L.registerDefinitionProvider(id, { provideDefinition: (m, p) => client.definition(m, p) }),
		L.registerReferenceProvider(id, { provideReferences: (m, p, c) => client.references(m, p, c.includeDeclaration) }),
		L.registerDocumentHighlightProvider(id, { provideDocumentHighlights: (m, p) => client.highlights(m, p) }),
		L.registerDocumentSymbolProvider(id, { provideDocumentSymbols: (m) => client.symbols(m) }),
		L.registerCompletionItemProvider(id, { triggerCharacters: ["@"], provideCompletionItems: (m, p) => client.completion(m, p) }),
		L.registerSignatureHelpProvider(id, {
			signatureHelpTriggerCharacters: ["(", ","],
			provideSignatureHelp: (m, p) => client.signature(m, p),
		}),
		L.registerFoldingRangeProvider(id, { provideFoldingRanges: (m) => client.folding(m) }),
		L.registerDocumentFormattingEditProvider(id, { provideDocumentFormattingEdits: (m, o) => client.format(m, o) }),
		L.registerDocumentRangeFormattingEditProvider(id, { provideDocumentRangeFormattingEdits: (m, r, o) => client.format(m, o, r) }),
		L.registerRenameProvider(id, {
			provideRenameEdits: (m, p, name) => client.rename(m, p, name),
			resolveRenameLocation: (m, p) => client.prepareRename(m, p),
		}),
		L.registerCodeActionProvider(id, { provideCodeActions: (m, r, c) => client.codeActions(m, r, c.markers) }),
	];
}
