# Deploying the phase-1 stopgap on a Linux server

Hand-off document for standing up NLP-Studio phase 1 on a Linux host. Written for a
fresh Claude Code session working with David on the server; usable by hand too.

Everything below has been verified working on Windows/Docker Desktop against
`gitpod/openvscode-server` (Ubuntu 22.04 base). Nothing here has been run on the target
server yet — treat the checks in step 0 as real gates, not formalities.

**Target directory: `/home/visualtext/nlp-studio`** (David has access to `/home/visualtext/`).

---

## Read this first: there is no authentication

The base image's entrypoint passes `--without-connection-token`. Anyone who can reach the
port gets a full VS Code instance **and a terminal running as the container user**. There is
no login, no password, no token.

So the default path below binds the container to `127.0.0.1` only and reaches it through an
SSH tunnel. Do not publish port 3000 on a public interface as a "quick test" — that is a
remote shell on the internet. Exposing it properly is step 6, and it is a deliberate,
separate decision.

---

## Step 0 — Preflight

Run these before anything else. Each one gates a later step.

```bash
uname -m                      # MUST be x86_64
docker --version              # need Docker
docker compose version        # need Compose v2 (or use `docker-compose`)
node --version                # need >= 18, to build the vsix
git --version
df -h /var/lib/docker         # need ~4 GB free (1.5 GB image + build layers)
```

**`uname -m` is a hard gate.** The NLP++ engine ships prebuilt Linux binaries for x86-64
only (`ubuntu-20.04.zip` / `ubuntu-22.04.zip` / `ubuntu-latest.zip` in the
[nlp-engine releases](https://github.com/VisualText/nlp-engine/releases)). On `aarch64` the
image will build and then fail at runtime with an exec-format error. If the server is ARM,
stop and tell David — this needs an ARM engine build first, which is a separate project.

If Docker is missing, ask David before installing it. Installing a daemon on his server is
his call, not a detail to sort out silently.

## Step 1 — Clone

```bash
cd /home/visualtext
git clone https://github.com/VisualText/nlp-studio.git
cd nlp-studio
```

## Step 2 — Build the extension package

The Dockerfile expects `stopgap/vsix/vscode.nlp.vsix`, which is **not** committed (it is
~3 MB and rebuilt from source). The extension is published only to the Microsoft
marketplace, not to Open VSX, so openvscode-server cannot install it by id — the vsix has to
be built.

```bash
cd /home/visualtext
git clone https://github.com/VisualText/vscode-nlp.git      # if not already present
cd /home/visualtext/nlp-studio/stopgap
VSCODE_NLP_DIR=/home/visualtext/vscode-nlp ./scripts/build-vsix.sh
```

`npm ci` on `vscode-nlp` takes a few minutes. Expect the script to finish with:

```
build-vsix: wrote /home/visualtext/nlp-studio/stopgap/vsix/vscode.nlp.vsix
```

**If Node is unavailable or npm fails**, the fallback is to build the vsix on a machine that
has Node (David's Windows box already has it working) and copy it over:

```bash
scp vscode.nlp.vsix visualtext@<server>:/home/visualtext/nlp-studio/stopgap/vsix/
```

Nothing else in the build needs Node.

## Step 3 — Build the image

```bash
cd /home/visualtext/nlp-studio/stopgap
docker compose build
```

Takes ~5 minutes on a cold cache (1.5 GB base image pull, ~50 MB of engine assets from
GitHub). The build needs outbound HTTPS to `github.com`.

Watch for this near the end — it is the build verifying its own work:

```
install-engine: base image VERSION_ID=22.04 -> ubuntu-22.04.zip
install-engine: verifying layout
  ok      nlp.exe
  ok      data/rfb
  ok      include
  ok      lib
  ok      visualText/spec
  ok      visualText/Help
  ok      visualText/analyzer-templates
  ok      analyzers
install-engine: nlp.exe reports version: 3.7.13
seed-workspace: 17 analyzers in /home/workspace
```

Any `MISSING` line fails the build deliberately. A partial engine layout would otherwise
make the extension re-download ~45 MB on every container start.

## Step 4 — Run it, bound to localhost

Edit `stopgap/docker-compose.yml` and change the port mapping:

```yaml
    ports:
      - "127.0.0.1:3000:3000"      # was "3000:3000"
```

That single change is what keeps this off the public internet. Then:

```bash
docker compose up -d
docker compose logs --tail=20
```

Expect:

```
Server bound to 0.0.0.0:3000 (IPv4)
Extension host agent listening on 3000
Extension host agent started.
```

("Bound to 0.0.0.0" is *inside* the container — the Docker port mapping is what restricts
it to localhost on the host.)

## Step 5 — Verify before declaring victory

**5a. The server answers:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/?folder=/home/workspace'
# expect: 200
```

**5b. The extension is installed:**

```bash
docker compose exec nlp-studio ls /home/nlpstudio/.vscode/extensions
# expect: dehilster.nlp-3.11.13  extensions.json
```

**5c. An analyzer actually runs** — this is the real test, and the one that catches an
architecture or engine-layout problem:

```bash
docker compose exec nlp-studio bash -c '
set -e
eng=/home/nlpstudio/.vscode/extensions/dehilster.nlp-3.11.13/nlp-engine
ana="/home/workspace/Telephone Numbers"
mkdir -p "$ana/input"
echo "Call me at 555-1212 or (800) 555-0199 tomorrow." > "$ana/input/test.txt"
cd "$eng"
./nlp.exe -ANA "$ana" -WORK "$eng" "$ana/input/test.txt" >/dev/null 2>&1
grep -c _telephone "$ana/input/test.txt_log/final.tree"
'
# expect: a count >= 1
```

A `_telephone` node in `final.tree` means the engine loaded its KB, ran the pass sequence,
and matched a rule. That is the whole stack working.

**5d. Open it in a browser.** From your laptop:

```bash
ssh -N -L 3000:localhost:3000 visualtext@<server>
```

Then open <http://localhost:3000/?folder=/home/workspace>.

**The `?folder=` parameter is required.** The extension reads
`vscode.workspace.workspaceFolders` to find analyzers; with no folder open, the analyzer,
sequence, and KB views are all empty and it looks broken. Without a `?folder=`, expect a
confused bug report.

You should see 12 tutorials and 5 starter templates in the analyzer view.

## Step 6 — Exposing it publicly (only if David asks)

Do not do this as part of standing it up. It is a separate decision with real consequences,
and it needs at minimum:

- **A reverse proxy with authentication** in front of port 3000 — Caddy with `basic_auth`
  is the smallest thing that works; OAuth is better if this becomes a public demo.
- **TLS**, since anything typed into the editor otherwise crosses the network in the clear.
- **A resource cap on the container** (`mem_limit`, `cpus`) — an NLP++ pass with a runaway
  rule can spin a core indefinitely, and there is no timeout in the stopgap.
- **A decision about state.** The named volume persists analyzers across restarts, so
  whatever one visitor writes, the next visitor sees. If this is a public "try NLP++"
  demo, that is wrong — it wants ephemeral per-session containers instead, which is
  really phase 2's problem, not something to retrofit here.

Concurrent users on one container share a filesystem and will overwrite each other's work.
The stopgap is single-tenant by design.

---

## Troubleshooting

**`exec format error` when running `nlp.exe`** — the host is ARM. See step 0.

**Build fails with `ENOENT ... mkdir '/home/nlpstudio/.openvscode-server/data/User/...'`** —
`$HOME` was not created before the extension install step. The committed Dockerfile has the
`mkdir -p` that fixes this; if you see it, the Dockerfile has been modified.

**`bad interpreter: /usr/bin/env bash^M`** — the shell scripts got CRLF line endings. The
repo has a `.gitattributes` pinning `*.sh` to `eol=lf`; if a checkout still produced CRLF,
run `dos2unix stopgap/scripts/*.sh`.

**Extension views are empty / no analyzers listed** — almost always a missing `?folder=`
in the URL. See step 5d.

**The extension re-downloads the engine on every start** (visible as slow first activation
and download progress in its log view) — the engine layout or the extension install path is
wrong. Check that extensions live in `/home/nlpstudio/.vscode/extensions` and not
`/home/nlpstudio/.openvscode-server/extensions`; the extension's `getExtensionDirs()` scans
the former and reads its version from the directory name. See
[../stopgap/README.md](../stopgap/README.md) for why.

**Port 3000 already in use** — change the host side of the mapping only:
`"127.0.0.1:3001:3000"`.

---

## Context for the session picking this up

- This is **phase 1 of NLP-Studio**, a deliberate stopgap: the real `dehilster.nlp` VS Code
  extension running in a browser via `openvscode-server`, with the NLP++ engine baked into
  the image. Zero porting, full feature parity, one container per user.
- It is **not the product.** Phase 2 is a purpose-built web app — Monaco front end reusing
  the extension's TextMate grammars and themes, over a Node API server hosting the engine
  in-process via `nlpplus`. See [ARCHITECTURE.md](ARCHITECTURE.md).
- **Do not invest in hardening this into a multi-tenant service.** Auth, per-user
  workspaces, sandboxing, and resource limits are phase-2 concerns and belong in the real
  server, not bolted onto a VS Code container. If the stopgap is hitting those limits, that
  is the signal to start phase 2, not to keep patching phase 1.
- Open question David has not decided: **teaching playground or real multi-user IDE?** It
  changes phase-2 scope substantially. Worth asking if it comes up.
