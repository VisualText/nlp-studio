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
  outline, a misspelled call flagged with its fix, and switching analyzers — and, with a
  run server, running the sample, opening its parse trees and going from a node to its rule
  and its text, and a run error landing on its line.

### Running analyzers (implemented)

**Run** sends the analyzer as it stands in the editor, with the text of one input file, to
the run server (`studio/server/app.py`), and shows what comes back under the editor: the
files the analyzer wrote, problems, and the engine's log. Its parse trees open in the editor.

- **Python, not Node.** The target design above hosts the engine in-process through
  `nlpplus`. The run server uses the NLPPlus Python package (pinned, 2.2.37) instead — the
  build already run against real analyzers elsewhere — and needs nothing besides it and the
  standard library.
- **One process per run, not the engine in-process.** The engine caches analyzers by name
  for the life of its process, an NLP++ loop can run forever, and some mistakes stop the
  engine outright (writing an attribute with no base knowledge base is one). So each run
  gets a fresh process and a temporary folder: the server kills it at the timeout (10 s by
  default) and reports a crash rather than dying of one. A process costs about half a
  second to start.
- **Results are the files the engine writes.** `output/final.tree` is the parse tree;
  `logs/make_ana.log` and `output/err.log` hold build and run errors as
  `<pass> <line> [message]`; the rest of `output/` is the analyzer's own. A problem links to
  its line, which is marked in the editor.
- **What a run wrote is a file list, not a dump.** As in the extension's OUTPUT FILES view, the
  files the analyzer wrote are listed by name with their icons under **Output**, and open
  read-only in the editor (`languageFor` gives each its colouring). Their text comes back with
  the result, so opening one asks the server for nothing. The results panel's **Output** tab
  lists the same files the same way — that is where a run's results are read, and a tab that
  says "the analyzer wrote no output files" beats a section that is simply absent — and both
  lists open a file in the editor rather than dumping its text.
- **A run says it is running.** The Run button turns and reads "Running…", and the panel opens
  at once with what is running, rather than leaving the last run's results on screen until the
  new one lands.
- **Trees open in the editor, one at a time.** Trees get very large, so they are not sent with
  the result. The server moves a run's trees aside (`trees.py`: for the person who ran it, for
  30 minutes, the newest 20 runs and 256 MB) and the page lists them; opening one fetches it
  (`GET /api/run/tree`) into a read-only editor document in the `tree` language. **Debug**
  runs the engine in its develop mode, which also writes `output/ana###.tree` after every
  pass. Each tree node carries the pass and rule line that built it, so hover shows a node's
  text and go to definition opens its rule (`run/treeview.ts`).
- **The file list follows the extension's sequence view.** The section is "Analyzer Sequence",
  each pass carries the icon `sequenceView.ts` would give it (the DNA helix for a rule pass,
  grey when it is switched off, a pink-headed helix for a recursive one, a folder, a dot for
  anything else), and the sequence line's comment is the mouse-over rather than a second line
  under the name — the extension's `passTooltip`, file path and all. The knowledge base, the
  input and the parse trees carry their icons too (`dict`, `kbb`, `file`, `tree`), as
  `kbView`/`textView` give them. `src/icons.ts` holds that artwork inlined from
  `vscode-nlp/resources` (MIT), shapes carrying `currentColor` so one copy serves both themes
  and a switched-off pass is the same shape in grey rather than a second drawing.
- **Tree colours are the extension's.** The grammars name scopes no stock theme knows
  (`keyword.node.tree`, `keyword.rewrite.tree`, `keyword.concept.kbb2`), which is why VS Code
  colours them through `editor.tokenColorCustomizations` in the `.vscode/settings.json` that
  `vscode-nlp` and the analyzer repositories ship. `src/tokencolors.ts` holds those rules, rule
  for rule, for light and for dark, and `highlight.ts` folds them into both shiki themes.
  Without them a tree is one flat keyword colour.
- **Pass numbers are the engine's.** A switched-off pass (`/nlp name`) keeps its number and
  a folder or stub has none. That was measured, not assumed, and both the page
  (`analyzers.ts`) and the server number `analyzer.seq` the same way.
- **Offsets.** The tree gives byte and code-point offsets. The page converts code points to
  UTF-16 before selecting text, so text beyond the Basic Multilingual Plane (emoji)
  selects correctly.
- **The Linux engine is not the Windows one** — measured on NLPPlus 2.2.37 in CI and WSL,
  and it matters because the deployed server is Linux:
  - `openfile("name")` created nothing before nlp-engine 4.1.3: the Linux build opened
    the file read-write (`lite/fn.cpp`, `fnOpenfile`), which cannot create one, and the
    analyzer carried on without a word. Fixed in VisualText/nlp-engine#742 and released
    as NLPPlus 2.2.38, which the run server pins. For an older engine the server still
    reports a name-only `openfile()` whose file did not appear, at its line;
    `openfile("name", "app")` works with every version.
  - Log lines end with a NUL byte before the newline; the server strips it.
  - A missing base knowledge base only warns, where on Windows it stops the engine.

#### The run server is not a sandbox

NLP++ has `system()`, and file functions that take any path (`openfile`, `readfile`,
`mkdir`, ...). Running someone's analyzer is running their code.

What the server does. Before running, it refuses an analyzer that calls `system()`,
`urltofile()`, `resolveurl()`, `deletefile()`, `unpackdirs()`, the `db*()` functions or the
desktop app's popups. It drops credential-like variables from the run's environment and
gives every run its own temporary folder, a wall-clock timeout, size limits on the request
and on what comes back, and a cap on concurrent runs — plus CPU, file-size and memory
limits on Linux.

What it does not do is contain the file functions. They cannot be refused — the
knowledge-base library every template ships uses them — so an analyzer can read and write
anything the server's user can. On a developer's own machine that is no more than running
the analyzer in VS Code, and that is the case this slice is for: the server listens on
127.0.0.1 and has no authentication.

Before strangers can run analyzers, the operating system has to contain the run process: a
container or sandbox per run (nsjail, bubblewrap, gVisor) with a read-only filesystem apart
from the run folder, no network, an unprivileged user and no host secrets — and
authentication or rate limits in front. That is not built.

What is built is narrower: on studio.visualtext.org the studio runs at `/studio/`, as a
container beside the phase-1 editor, behind the site's password or GitHub sign-in for
invited people ([studio/deploy/](../studio/deploy/INSTALL.md)). The container has a
read-only root filesystem with only `/tmp` writable, no Linux capabilities, an unprivileged
user, and CPU, memory and process limits — so a run can write nowhere but its own temporary
folder. It shares the host's network, as that host's firewall forces on the phase-1
container too, so it is not network-isolated; NLP++ has no built-in that opens a
connection, so what is left open is a flaw in the engine itself. Behind the password that
adds nothing, since everyone with it already has a terminal on the host through phase 1.
With sign-in, the invited list — not a sign-up — is what decides who gets that far, and
`NLP_STUDIO_REQUIRE_SIGN_IN=1` makes the server refuse to start rather than run open when
the proxy asks for no password.

### Keeping work (implemented)

Edits are saved in the browser as they are typed (`studio/src/drafts.ts`). Each analyzer has
one localStorage record holding only the files that differ from what was opened; it is
written half a second after typing stops, and whenever the tab is hidden or closed, so
nothing waits on a save button. Reopening the analyzer brings the edits back. Changed files
are marked and can be reverted one at a time or all together, and **Download** zips the
analyzer's folder with the edits in it. A browser that blocks storage, or has run out of it,
is told so on screen rather than found out after a reload.

Every opened file is held with `\n` line endings: that is what a draft is compared with,
what is saved, what runs and what downloads. Otherwise a Windows checkout's CRLF, or a file
with both, would look changed before anyone touched it.

This is the first piece of the next step — an editor for invited people, with analyzers
in GitHub repositories. Drafts hold the work between opening an analyzer from a repository
and committing it back, on a branch with a pull request.

### Analyzers from GitHub (implemented)

The editor is for invited people, and their analyzers live in GitHub repositories.

- **Signing in is the server's.** GitHub will not exchange a sign-in code from a browser —
  `github.com/login/oauth/access_token` sends no CORS headers — so `server/app.py` runs a
  GitHub App's sign-in: the redirect with a one-time state, the code exchange, and a check of
  the login against `NLP_STUDIO_USERS`. The token goes into an in-memory session behind an
  HttpOnly, SameSite=Lax cookie (Secure on https) and is refreshed when it expires. A restart
  signs everyone out; no token touches the disk.
- **The page never holds a token.** `api.github.com` would accept calls from the page, but the
  server makes them (`server/github.py`), so nothing in an analyzer file the editor renders can
  reach it. So far: the repositories the app reaches for this person, the analyzers in one at a
  commit, and one analyzer's files.
- **An analyzer is any folder holding `spec/analyzer.seq`,** at any depth, read at the commit it
  was listed at. Only its `spec/`, `kb/` and `input/` travel, as for the samples.
- **Drafts follow the repository, branch and folder**, not the commit, so edits carry over when
  the branch moves on. Opened analyzers are remembered in the browser and reopen at the branch's
  latest commit.
- **Committing back is a pull request, never a push to the branch the analyzer came from.**
  **Commit…** sends the changed files. The server makes one commit on top of the commit the
  analyzer was opened at — so it holds exactly the person's changes, and GitHub shows any
  conflict if the branch has moved — puts it on a new branch
  `nlp-studio/<login>/<analyzer>-<date-time>` and opens a pull request into the branch it came
  from. The analyzer then reopens from the new branch; committing again adds to that branch,
  which updates the pull request, and is refused if the branch has moved on in the meantime.
  Drafts are let go only once the analyzer has reopened from the commit.
- With sign-in configured, running analyzers needs a signed-in person too.
- The whole flow is tested against a stand-in GitHub (`server/fake_github.py`): sign-in,
  refusal of anyone not invited, token refresh and reading in `server/test_github.py`, and
  opening and running an analyzer from a repository in the browser self test.

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
