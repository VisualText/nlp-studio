# NLP-Studio

An online editor for [NLP++](https://visualtext.org) analyzers, modeled after the
[NLP++ VS Code extension](https://github.com/VisualText/vscode-nlp) (`dehilster.nlp`).

The goal is to let anyone open a browser, write NLP++, run an analyzer over text, and
see the parse tree — with no install, no C++ toolchain, and no VS Code.

## Status

| Phase | What | State |
|---|---|---|
| **1. Stopgap** | `openvscode-server` container with the real `dehilster.nlp` extension baked in | **in this repo** — see [stopgap/](stopgap/) |
| **2. Studio** | Purpose-built web app: Monaco front end + an API server running the engine | **live** — in [studio/](studio/): the editor, the run server, analyzers opened from GitHub and committed back, deployed at studio.visualtext.org/studio/ for invited people |
| **Shared views** | `@visualtext/analyzer-views`: the sequence, knowledge base, output files, parse trees, code, log and values as web components, for the studio and any other page that shows an analyzer | **released** — see [analyzer-views/](analyzer-views/) |
| **3. Client-side** | Emscripten/WASM build of the engine for zero-server demos | speculative |

Phase 1 exists to have something live quickly — a "Try NLP++" button for
[book.visualtext.org](https://book.visualtext.org). It is the full desktop experience in a
browser tab, at the cost of one container per user. It is deliberately **not** the product.

Phase 2 is the product. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and
the reasoning behind it.

## Quick start (phase 2)

Requires Node 20+, and Python 3.11+ to run analyzers. A checkout of
[`analyzer-templates`](https://github.com/VisualText/analyzer-templates) next to this repo
(`../analyzer-templates`) adds five templates to the analyzer list; without it the studio
opens its own sample only.

```bash
npm install --prefix analyzer-views   # the shared lists, built before the studio runs
cd studio
npm install
pip install -r server/requirements.txt   # NLPPlus, the engine -- a venv is a good idea
npm run server               # the run server, on http://127.0.0.1:8765
npm run dev                  # in a second terminal: http://localhost:5173
```

Edit an analyzer and press **Run** (F5) to run it on the input file. Under the editor, **Output**
shows the values the run found — the fields its `output.json` filled, by name — and lists the
files it wrote, with **Problems** and **Log** beside it; the same files are listed in
the file list under **Output**, and its parse tree under **Parse trees**, each with the icon the
VS Code extension gives it. Click one and it fills the
editor, read-only — a tree coloured as the extension colours trees, node names green, rewrites
bold, offsets blue. Hover over a node to see the text it covers; go to
definition (F12) opens the rule that built it, or selects a token's text in the input. Tick
**Debug** — the engine's `-DEV` — to also keep the tree after every pass: each pass in the
sequence then carries two buttons, its parse tree and what its rules matched (the input with
`<<<what a rule built>>>` and `((( what one matched )))` marked, as the extension's Display
Matched Rules shows it). Trees can be large, so the run server keeps
them for half an hour and sends one only when it is opened. Without the run server the studio still edits —
colouring, hover, go to definition, completion, rename and problems all run in the browser,
the language features in the NLP++ language server from `vscode-nlp` in a Web Worker.

Edits are kept in your browser as you type, and come back when you open the analyzer again.
Changed files are marked and can be reverted, and **Download** saves the analyzer — with your
edits — as a zip of its folder, ready to open in VS Code.

```bash
npm test                            # page unit tests
npm run test:server                 # run-server tests (the engine tests need NLPPlus)
npm run build && npm run selftest   # the built page, checked in headless Edge or Chrome
```

`npm run selftest` starts a run server as well, with the Python that runs it or
`NLP_PYTHON`, and skips the run checks — saying so — when that Python has no NLPPlus.
`npm run build` writes `studio/dist/`, a static site; `python server/app.py --dist dist`
serves the site and the API from one address.

**The run server has no authentication and is not a sandbox** — NLP++ can read and write
files. It listens on 127.0.0.1. Read
[Running analyzers](docs/ARCHITECTURE.md#running-analyzers-implemented) before letting
anyone else reach it.

**Analyzers from GitHub.** Signed in with GitHub, **Open from GitHub** lists the repositories
you can reach, finds every analyzer in one (any folder holding `spec/analyzer.seq`) and opens
it, with your edits kept as drafts; **Commit…** puts them on a new branch with a pull request
(and committing again adds to that pull request). The server does the signing in and holds the GitHub token —
the page never sees it — so it needs a GitHub App, and in its environment:

| Variable | |
|---|---|
| `NLP_STUDIO_GITHUB_CLIENT_ID`, `NLP_STUDIO_GITHUB_CLIENT_SECRET` | the GitHub App's |
| `NLP_STUDIO_USERS` | the invited GitHub logins, comma-separated |
| `NLP_STUDIO_PUBLIC_URL` | where the page is served, e.g. `https://studio.visualtext.org/studio` |

With these set, running analyzers also needs a signed-in, invited person. On your own machine,
`NLP_STUDIO_GITHUB_TOKEN=<a personal access token>` gives the GitHub calls that token instead,
with no sign-in — never on a server anyone else can reach.

Deploying beside the phase-1 editor, at studio.visualtext.org/studio/ — behind the site's
password, or with GitHub sign-in for invited people:
[studio/deploy/INSTALL.md](studio/deploy/INSTALL.md).

## Quick start (phase 1)

Requires Docker and a checkout of [`vscode-nlp`](https://github.com/VisualText/vscode-nlp)
next to this repo (`../vscode-nlp`).

```bash
cd stopgap
./scripts/build-vsix.sh      # or scripts\build-vsix.ps1 on Windows
docker compose up --build
```

Then open <http://localhost:3000/?folder=/home/workspace>.

The `?folder=` parameter matters — the extension needs an open workspace folder before its
analyzer views populate. Full details in [stopgap/README.md](stopgap/README.md).

Deploying to a Linux server: [docs/DEPLOY-LINUX.md](docs/DEPLOY-LINUX.md). Note that the
container has **no authentication** — read that document's first section before exposing it
anywhere.

## Related repositories

| Repo | Role here |
|---|---|
| [vscode-nlp](https://github.com/VisualText/vscode-nlp) | Source of the extension, TextMate grammars, themes, and view logic |
| [nlp-engine](https://github.com/VisualText/nlp-engine) | The C++ engine; release assets are baked into the phase-1 image |
| [npm-package-nlpengine](https://github.com/VisualText/npm-package-nlpengine) | `nlpplus` Node addon — the intended phase-2 server runtime |
| [nlp-compile-service](https://github.com/VisualText/nlp-compile-service) | Cloud compile for compiled-mode analyzers; reusable as-is |
| [analyzers](https://github.com/VisualText/analyzers) | Tutorial and sample analyzers seeded into the workspace |
