# NLP-Studio

An online editor for [NLP++](https://visualtext.org) analyzers, modeled after the
[NLP++ VS Code extension](https://github.com/VisualText/vscode-nlp) (`dehilster.nlp`).

The goal is to let anyone open a browser, write NLP++, run an analyzer over text, and
see the parse tree — with no install, no C++ toolchain, and no VS Code.

## Status

| Phase | What | State |
|---|---|---|
| **1. Stopgap** | `openvscode-server` container with the real `dehilster.nlp` extension baked in | **in this repo** — see [stopgap/](stopgap/) |
| **2. Studio** | Purpose-built web app: Monaco front end + Node API server hosting the engine in-process | designed, not started |
| **3. Client-side** | Emscripten/WASM build of the engine for zero-server demos | speculative |

Phase 1 exists to have something live quickly — a "Try NLP++" button for
[book.visualtext.org](https://book.visualtext.org). It is the full desktop experience in a
browser tab, at the cost of one container per user. It is deliberately **not** the product.

Phase 2 is the product. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and
the reasoning behind it.

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
