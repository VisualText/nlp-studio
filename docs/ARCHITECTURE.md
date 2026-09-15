# NLP-Studio architecture

## The problem

The NLP++ development experience currently requires installing VS Code, installing the
`dehilster.nlp` extension, and letting that extension download a platform-specific
`nlp.exe` plus ~30 MB of supporting data. That is a reasonable ask for a working NLP++
developer and an unreasonable one for someone who just read a chapter of the textbook and
wants to see a parse tree.

NLP-Studio removes the install step.

## Phase 2: the target design

**A browser SPA using Monaco, talking to a Node API server that hosts the engine
in-process via `nlpplus`.**

```
┌──────────────────────────────┐         ┌────────────────────────────────┐
│  Browser (SPA)               │  REST   │  Node API server               │
│                              │  + WS   │                                │
│  Monaco editor               │ ──────▶ │  nlpplus (Node-API addon)      │
│   + .tmLanguage grammars     │         │   └─ nlp-engine C++ in-process │
│   + VisualText themes        │ ◀────── │                                │
│  Analyzer / sequence / KB    │         │  per-user workspace dirs       │
│  Parse-tree viewer           │         │  run sandbox + timeouts        │
└──────────────────────────────┘         └──────────────┬─────────────────┘
                                                        │ POST /build
                                                        ▼
                                          ┌────────────────────────────┐
                                          │  nlp-compile-service       │
                                          │  (existing, unchanged)     │
                                          └────────────────────────────┘
```

### Why Monaco

Monaco *is* the VS Code editor core, which makes the existing extension's language assets
portable rather than reimplementable:

- All seven TextMate grammars in `vscode-nlp/syntaxes/` — `nlp`, `dict`, `kb`, `kbb`,
  `seq`, `tree`, `txxt` — load into Monaco via `shiki` / `monaco-textmate` unchanged.
- `vscode-nlp/themes/` and `vscode-nlp/snippets/` carry over directly.

This is the single largest reuse win in the project, and the reason to prefer Monaco over
Ace or CodeMirror (both of which are already cloned under `c:\git` from earlier
exploration, and neither of which consumes VS Code grammars or themes).

### Language features run in the browser (implemented)

The first slice of phase 2 is the editor, in [../studio/](../studio/), and it needs no server.

```
┌──────────────────────────── browser tab ────────────────────────────┐
│  Monaco (editor core only)          Web Worker                      │
│   ├─ shiki + the 7 TextMate  ─┐                                     │
│   │  grammars → colouring      │    NLP++ language server           │
│   └─ lsp/client.ts ────────────┼──▶ (vscode-nlp browserServer.js)   │
│        providers ◀─ JSON-RPC ──┘     indexes the open analyzer      │
│  analyzer list, passes, KB, input ◀── static files (analyzers/)     │
└─────────────────────────────────────────────────────────────────────┘
```

- **The language server is the extension's.** `vscode-nlp` 4.2.0 builds its server twice:
  for Node (the extension) and as `dist/browserServer.js`, a Web Worker that reads the
  workspace from `nlp/workspaceFiles` notifications instead of the disk. The studio commits
  that bundle (`studio/public/language-server/`, with its source commit) so hover text,
  diagnostics and quick fixes are the extension's, not a second implementation.
- **A small client, not `monaco-languageclient`.** That package runs much of VS Code's
  workbench inside the page. One language needs a dozen requests, each mapped to a Monaco
  provider in `studio/src/lsp/client.ts`, with the conversions unit-tested.
- **Monaco without its languages.** `studio/src/monaco.ts` imports the editor API and its
  features, not the TypeScript/CSS/HTML/JSON services or Monarch grammars.
- **One workspace at a time.** Opening an analyzer replaces the server's files
  (`replace: true`); edits are sent as they happen and "saved" after a pause, so a new
  function is known to every pass without pressing save.
- **Checked in a real browser.** `npm run selftest` opens the build headless and the page
  checks itself through the editor: go to definition across passes, hover, completion,
  outline, a misspelled call flagged with its fix, and switching analyzers.

Running an analyzer is the next slice and is where the server below comes in.

### Why the engine stays server-side

The engine is a native C++ binary. `nlpplus` links it as a Node-API addon and runs calls
in-process — no subprocess spawn per analysis, unlike `ts-nlp-engine`, which shells out to
`nlp.exe`. For a web app serving many short analyses, that difference dominates latency.

Requirements this imposes:

- **Per-user workspace directories.** An analyzer is a folder (`spec/`, `kb/`, `input/`),
  not a single file. The API is file-oriented, not document-oriented.
- **Sandboxed runs with hard timeouts.** A runaway NLP++ pass must not take down the
  server. Run analyses in a worker or short-lived container with a wall-clock limit.
- **Resource limits per user** if workspaces persist.

### View layer

The extension's view providers map one-to-one onto panels, and their *logic* — what to
enumerate, what to show, what a double-click does — ports even though the
`TreeDataProvider` shell does not:

| `vscode-nlp/src/` | NLP-Studio panel |
|---|---|
| `analyzerView.ts` | Analyzer list / switcher |
| `sequenceView.ts` | Pass sequence (`analyzer.seq`) |
| `kbView.ts` | Knowledge base browser |
| `textView.ts` | Input text files |
| `outputView.ts` | Analyzer output files |
| `logView.ts` | Run log |
| `findView.ts` | Search results |

Sequence editing is the clearest upgrade: reordering passes by dragging is natural in a
real DOM and awkward in a VS Code tree view.

### The parse-tree viewer

This is the feature worth building well, and the strongest argument for a purpose-built app
over a VS Code port. In VS Code the parse tree is text in a tree control. On the web it can
be an interactive graph — collapse subtrees, zoom, click a node to highlight both its source
span and the rule that matched it. That is what demonstrates NLP++'s glass-box claim in
thirty seconds.

### Compiled mode

`nlp-compile-service` already accepts `POST /build` with an analyzer tarball and returns a
platform-specific shared library. The API server can call it exactly as the extension does,
so compiled mode needs no new infrastructure.

## Phase 1: the stopgap (what is implemented here)

`gitpod/openvscode-server` with the real `dehilster.nlp` extension installed and the engine
pre-baked. Zero porting, full feature parity, ships immediately.

Its limits are the reason it is not the product:

- One container per user; the whole VS Code stack per session.
- You inherit VS Code's UI rather than designing one for NLP++.
- No shared workspace model, no accounts, no multi-tenancy.

Implementation notes live in [../stopgap/README.md](../stopgap/README.md).

## Phase 3: WASM (not scheduled)

Emscripten-compiling the engine to run entirely client-side is appealing — zero server
cost, instant startup, trivially scalable. The obstacles are real:

- The engine is filesystem-heavy (KB files, `.dict` files). `parse-en-us` alone carries a
  ~191k-entry dictionary. This needs Emscripten's virtual FS with IndexedDB persistence.
- Compiled mode disappears; everything runs interpreted.
- Memory limits constrain analyzer size.

Worth revisiting only if hosting costs for phase 2 actually become the binding constraint.

## Open question

Phase 2's scope depends on one decision that has not been made:

**Is NLP-Studio a teaching/demo playground or a real multi-user IDE?**

- *Playground*: ephemeral workspaces, curated sample analyzers, no accounts. Simpler by a
  wide margin.
- *IDE*: users keep and version their own analyzers. Needs auth, durable storage, quotas,
  and per-user resource limits designed in from the start rather than bolted on.

The architecture above serves both. The difference is entirely in what surrounds it.
