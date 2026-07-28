# NLP-Studio phase 1 — the stopgap

`gitpod/openvscode-server` with the real `dehilster.nlp` extension installed and the NLP++
engine pre-baked. Full desktop feature parity in a browser tab, with no porting.

This ships something usable now. It is not the product — see
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Build and run

Requires Docker, Node 18+, and a checkout of
[`vscode-nlp`](https://github.com/VisualText/vscode-nlp) at `../../vscode-nlp`.

```bash
./scripts/build-vsix.sh        # Windows: scripts\build-vsix.ps1
docker compose up --build
```

Open **<http://localhost:3000/?folder=/home/workspace>**.

The `?folder=` query parameter is required. The extension reads
`vscode.workspace.workspaceFolders` to find analyzers; with no folder open, the analyzer,
sequence, and KB views stay empty and nothing works. `?folder=` is standard `vscode-web`
behavior, which is why it is used here instead of a server flag.

To override where `vscode-nlp` lives:

```bash
VSCODE_NLP_DIR=/path/to/vscode-nlp ./scripts/build-vsix.sh
```

## How it fits together

```
gitpod/openvscode-server
├── /home/nlpstudio/                        HOME (moved off the mount point)
│   └── .vscode/extensions/
│       └── dehilster.nlp-<version>/        the extension, installed from vsix
│           └── nlp-engine/                 baked by scripts/install-engine.sh
│               ├── nlp.exe                 renamed from nlpl.exe
│               ├── data/rfb/
│               ├── include/  lib/          compile libs
│               ├── visualText/             spec, Help, analyzer-templates
│               └── analyzers/              sample analyzers
└── /home/workspace/                        the analyzer workspace (seeded)
```

Three details make this work, each of which fails in a non-obvious way if changed:

**`HOME` is moved to `/home/nlpstudio`.** The base image sets `HOME=/home/workspace`, which
is also its documented bind-mount point. The extension derives its engine directory from
`$HOME` (`visualText.extensionParentDirectory()`), so with the default `HOME`, bind-mounting
a host folder for the workspace would shadow the entire baked engine.

**Extensions install to `$HOME/.vscode/extensions`, not the server default.**
`getExtensionDirs()` scans `$HOME/.vscode/extensions` for a directory named
`dehilster.nlp-*` and takes the extension's version from that name. openvscode-server would
otherwise install to `$HOME/.openvscode-server/extensions`, the scan would find nothing,
`visualText.version` would stay empty, and the engine path would resolve to a malformed
`dehilster.nlp-/nlp-engine` — re-downloading the engine on every start. The `--extensions-dir`
flag in the Dockerfile's `CMD` keeps install and lookup in the same place.

**The engine is baked at build time.** Without it the extension downloads ~45 MB from GitHub
on first activation, per container. `install-engine.sh` reproduces the exact layout the
extension's updater validates, so at startup it finds everything present and queues nothing.

## Notes

- **The extension is not on Open VSX.** openvscode-server talks to Open VSX rather than the
  Microsoft marketplace, and `dehilster.nlp` is only published to the latter. That is why
  the vsix is built locally and copied in rather than installed by id. Publishing to Open
  VSX would let the Dockerfile use `--install-extension dehilster.nlp` and drop the build
  step entirely.
- **The engine binary is selected from `/etc/os-release`.** `install-engine.sh` picks
  `ubuntu-20.04.zip` / `ubuntu-22.04.zip` / `ubuntu-latest.zip` from the base image's actual
  release, mirroring `visualText.linuxZipName()`. Wrong binary means a glibc/ICU mismatch at
  runtime.
- **Analyzers run interpreted.** Compiled mode needs `nlp-compile-service`, which works from
  the container but requires outbound network access.
- **No connection token.** The base entrypoint passes `--without-connection-token`, so
  anyone who can reach port 3000 has a full editor and shell in the container. Fine on
  localhost; put it behind auth and a reverse proxy before exposing it.
- **One container per user.** There is no multi-tenancy here. Concurrent users on a single
  container share one filesystem and will overwrite each other's analyzers.
