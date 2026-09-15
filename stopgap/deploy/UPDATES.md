# Keeping studio.visualtext.org current

The live site is a Docker image with four upstream projects baked into it. None
of them update themselves at runtime -- the extension's own downloader is
deliberately short-circuited at build time (see `scripts/install-engine.sh`), so
the only way anything changes is a new image.

That rebuild is triggered from GitHub. When a source repo finishes attaching a
release's assets, it pings `nlp-studio`, and a workflow there runs on a
self-hosted runner on this server: build a new image, prove it works, swap it in.

```
  vscode-nlp / nlp-engine / visualtext-files / analyzers
        |
        |  .github/workflows/notify-studio.yml
        |  (fires when the ATTACH-ASSETS workflow succeeds, not on the release)
        v
  repository_dispatch: upstream-release
        |
        v
  nlp-studio/.github/workflows/deploy-studio.yml
        |
        |  runs-on: [self-hosted, nlp-studio]     <- a runner on this box
        v
  stopgap/scripts/update-studio.sh
        |
        +-- nothing changed?  exit, ~1 second
        +-- otherwise: fetch vsix -> build -> smoke-test -> swap -> health-check
```

| Project | What it provides | Hooked to |
|---|---|---|
| [vscode-nlp](https://github.com/VisualText/vscode-nlp) | the `dehilster.nlp` extension | workflow **Release** |
| [nlp-engine](https://github.com/VisualText/nlp-engine) | `nlp.exe`, `data/rfb`, compile libs | workflow **Move Assets to Release** |
| [visualtext-files](https://github.com/VisualText/visualtext-files) | spec, Help, analyzer templates | workflow **Attach Released Assets** |
| [analyzers](https://github.com/VisualText/analyzers) | tutorials and example collections | workflow **Attach Released Assets** |

## Why it hangs off the asset workflows, not the release

Publishing a release and attaching its assets are separate steps here -- the
`Attach ... Assets` and `Move Assets to Release` workflows run *after* the
release exists. A `release: published` trigger would fire while the `.vsix` and
the zips were still uploading, and the build would fetch a release with nothing
on it. `scripts/fetch-vsix.sh` fails loudly in exactly that case rather than
silently reusing a stale vsix, so the symptom would be a red deploy on every
release.

`Move Assets to Release` is specifically the right hook for `nlp-engine`: of the
several workflows there it is the aggregator that waits for the Linux, Windows
and macOS builds to finish. Hanging off `Linux` would fire while `nlpengine.zip`
was still missing.

## Extra pings are free

`update-studio.sh` compares upstream release tags against the labels on the
running image and exits in about a second when they match. It does not rebuild
because it was pinged; it rebuilds because something actually moved. So a source
workflow that pings on a run which released nothing -- `vscode-nlp`'s `Release`
runs on every push to master and only publishes when `package.json` changed --
costs nothing. Firing too often is safe; the design leans on that.

## Install

### 1. Two root commands, once

```bash
mkdir -p /opt/actions-runner-nlp-studio
chown visualtext:visualtext /opt/actions-runner-nlp-studio
loginctl enable-linger visualtext
```

**The runner cannot live under `/home`.** It reads every ancestor directory of
its own path, and on this cPanel host `/home` is `drwx--x--x root:root` --
deliberate hardening so accounts cannot enumerate each other. Any path under
`/home` fails at `config.sh` with *"Access to the path '/home' is denied"*.
Relaxing `/home` to 755 would undo that hardening for every account on the box,
so the runner goes outside it instead. `install-runner.sh` checks this up front
and refuses rather than letting you hit the confusing .NET error.

**Lingering** is what makes the runner survive logout and reboot. `systemd`
stops a user's units when their last session ends, so without it the runner works
until you disconnect and then the site silently stops updating. Verify with
`loginctl show-user visualtext -p Linger --value` (want `yes`).

### 2. The runner itself

Get a registration token from
<https://github.com/VisualText/nlp-studio/settings/actions/runners/new> (Linux /
x64 -- you only need the value after `--token`). They expire after an hour.

```bash
cd /home/visualtext/nlp-studio/stopgap/deploy/runner
RUNNER_DIR=/opt/actions-runner-nlp-studio ./install-runner.sh <registration-token>
```

**As `visualtext`, not root.** The runner must run as the account that owns the
site and is in the `docker` group; a root install registers the runner as root
and writes the systemd user unit into root's home, where it would never start for
this account. The script refuses to run as root. Root's only part is the three
commands above.

Re-running is safe: it skips the download if the runner is already unpacked, and
skips registration if it already registered — so finishing a partial install does
not need a fresh token.

### 3. The receiving workflow

`.github/workflows/deploy-studio.yml` is already in this repo. It needs no
secrets. Push it and it is live.

### 4. The four sending workflows

Copy each file from [workflows/](workflows/) into its repo as
`.github/workflows/notify-studio.yml`, **on that repo's default branch** --
`workflow_run` only fires for workflow files that exist there:

| File | Install into | Branch |
|---|---|---|
| [workflows/vscode-nlp.yml](workflows/vscode-nlp.yml) | `VisualText/vscode-nlp` | `master` |
| [workflows/nlp-engine.yml](workflows/nlp-engine.yml) | `VisualText/nlp-engine` | `master` |
| [workflows/visualtext-files.yml](workflows/visualtext-files.yml) | `VisualText/visualtext-files` | `main` |
| [workflows/analyzers.yml](workflows/analyzers.yml) | `VisualText/analyzers` | `master` |

Each needs the shared `CLASSIC_PAT` secret, which these repos already have for
the org's other cross-repo dispatches (`analyzers/dispatch-update-analyzers.yml`
uses the same one). The PAT needs `repo` scope to dispatch into `nlp-studio`.

### 5. Prove it end to end

Run `Notify NLP-Studio` by hand from the Actions tab of any source repo
(`workflow_dispatch` is enabled on all four for exactly this). A
`Deploy NLP-Studio` run should appear in `nlp-studio` within seconds and finish
"up to date; nothing to do".

## The phase-2 app at /studio/

The same workflow also keeps the phase-2 studio current: after `update-studio.sh`
it runs `studio/deploy/update.sh`, which rebuilds the `nlp-studio-app` container
when this checkout's commit or the visualtext-files release has moved, with the
same build, smoke-test, swap and roll-back steps. Until that script has been
pulled onto the server, the step says so and does nothing. Installing it:
[studio/deploy/INSTALL.md](../../studio/deploy/INSTALL.md).

## Security -- read before adding any trigger

The runner executes whatever `nlp-studio`'s workflows say, as `visualtext`, on
the machine that serves every visualtext.org site. That user is in the `docker`
group, which is root-equivalent (`docker run -v /:/host` reads and writes the
whole filesystem). **Push access to `nlp-studio` is therefore shell access to
this host.**

That is acceptable for a repo only you push to, but it means:

- **Never add a `pull_request` trigger** to `deploy-studio.yml`, and set
  Settings -> Actions -> "Fork pull request workflows from outside collaborators"
  to require approval. A fork PR under a `pull_request` trigger would run
  attacker-authored code here.
- Keep the triggers to `repository_dispatch`, `workflow_dispatch` and `schedule`.
- `deploy-studio.yml` deliberately does **not** check the repo out. It runs the
  scripts already deployed at `/home/visualtext/nlp-studio/stopgap`, so a push
  cannot silently change what executes on the server. Updating the scripts is a
  deliberate `git pull` here.
- The job declares `permissions: {}` -- it calls no GitHub API and needs no token
  scopes.

## The weekly safety net

`deploy-studio.yml` also has a `schedule:` trigger, Sundays 03:20 UTC, running
`--force`. It is a backstop, not the mechanism, and it covers two gaps:

- a ping that never arrived (expired `CLASSIC_PAT`, runner down, a source
  workflow that failed before its notify step)
- a rebased `gitpod/openvscode-server` base image, which no release announces and
  which decides *which engine binary* the build installs (the engine ships one
  per Ubuntu release; the wrong one dies at runtime on a glibc/ICU mismatch)

Delete the `schedule:` block if you would rather it only ever ran on a real
release. Note that a forced weekly run does rebuild and restart the container,
which drops open editor sessions -- see below.

## What a run does

1. Asks GitHub for the latest release tag of each of the four repos.
2. Compares them against the labels on the running image (`org.visualtext.*`).
   **If nothing moved it stops here.**
3. Downloads the released vsix for the resolved tag.
4. Builds `nlp-studio:candidate`, with every tag pinned to what step 1 resolved.
5. Smoke-tests the candidate (`scripts/smoke-test.sh`) on port 3999, separate
   from the live container.
6. Only if that passes: retags the live image `nlp-studio:previous`, promotes the
   candidate to `nlp-studio:stopgap`, and `docker compose up -d`.
7. Waits for `127.0.0.1:3000` to return 200. **If it does not, rolls back to
   `nlp-studio:previous` automatically.**
8. Copies any newly-seeded analyzers into the workspace volume, never
   overwriting anything already there.

A failure at steps 3-5 leaves the running site completely untouched. There is no
window in which the site serves an untested image.

## Running it by hand

From GitHub: Actions -> Deploy NLP-Studio -> Run workflow, with a mode of
`update`, `check`, `force` or `no-swap`.

On the server:

```bash
cd /home/visualtext/nlp-studio/stopgap

./scripts/update-studio.sh --check      # report drift, change nothing
./scripts/update-studio.sh              # update if behind
./scripts/update-studio.sh --no-swap    # build and test, leave the site alone
./scripts/update-studio.sh --force      # rebuild and swap even if current
```

`--check` exits 2 when an update is available, 0 when current. The two paths
cannot collide: `update-studio.sh` takes a `flock`, and the workflow uses a
`concurrency` group.

## The tags are pinned, not floating

`install-engine.sh` on its own fetches `releases/latest`, which is right for a
hand build. `update-studio.sh` resolves the tags once and passes them as build
args instead, for two reasons: the image can be labelled with exactly what went
into it (which is what makes the "has anything changed?" check possible at all),
and a release published while the build is running cannot produce an image whose
extension and engine came from either side of it.

## What is running right now

    docker image inspect nlp-studio:stopgap \
        --format '{{json .Config.Labels}}' | python3 -m json.tool

or from inside the container:

    docker exec nlp-studio cat \
        /home/nlpstudio/.vscode/extensions/dehilster.nlp-*/nlp-engine/.nlp-studio-versions

Every `Deploy NLP-Studio` run also writes this to its job summary in the Actions
tab. Full build output goes to `stopgap/logs/update-YYYY-MM.log` (kept 30 days)
as well as to the Actions log.

## Rolling back

The previous image is always kept:

    docker tag nlp-studio:previous nlp-studio:stopgap
    docker compose up -d

Only one generation is kept, so do this before the next deploy overwrites
`:previous`. To hold a known-good build indefinitely, tag it something else:

    docker tag nlp-studio:stopgap nlp-studio:known-good-2026-09

## Troubleshooting

**Nothing happens on a release.** Check in order: the source repo's
`Notify NLP-Studio` run (did the asset workflow succeed?), then `nlp-studio`'s
Actions tab (did the dispatch arrive?), then the runner:

    systemctl --user status github-runner-nlp-studio
    journalctl --user -u github-runner-nlp-studio -n 50

**The runner is "Offline" in GitHub.** Almost always lingering: after a reboot or
a logout, a user unit without `Linger=yes` does not come back.

    loginctl show-user visualtext -p Linger     # want Linger=yes

**A deploy is red.** The log says which stage failed. Failures before the swap
leave the site untouched; a failure after it rolls back on its own. Either way
the site is on a working image, and the fix is upstream.

## Things worth knowing

**Every deploy restarts the container.** `docker compose up -d` recreates it,
which drops every open WebSocket -- anyone in the editor gets a reloading page.
Files in the workspace volume survive; the session does not. With release-driven
deploys this now happens whenever you release, which given the current cadence
(several a day in bursts) is worth knowing before you cut a release at a busy
hour.

**The workspace volume is not replaced.** People's analyzers live in the named
volume `stopgap_nlp-studio-workspace` and survive every update. A named volume is
only seeded from the image the first time it is used, so step 8 above copies in
analyzers that are new since the volume was created. It never overwrites, so an
example someone has edited keeps their edits and will not pick up upstream
changes to it. To genuinely reset the seeded set -- destroying everything anyone
has written:

    cd stopgap && docker compose down && docker volume rm stopgap_nlp-studio-workspace

**Nothing here touches the proxy or the password.** The Apache/nginx configs and
`.htpasswd-studio` are independent of the image; see [INSTALL.md](INSTALL.md). A
deploy cannot open the site up, because it never edits those files.

**The engine binary follows the base image.** `install-engine.sh` reads
`/etc/os-release` in the base image and picks the matching `ubuntu-XX.YY.zip`.
`update-studio.sh` builds with `--pull`, so a rebased base is picked up and the
right binary follows. The smoke test runs `nlp.exe` specifically to catch it if
that ever goes wrong -- judging it on output, not exit status, since
`nlp.exe --version` prints its version and then exits 1.

**GitHub rate limits.** The five API calls per deploy come from the runner's own
IP against the unauthenticated 60/hour limit, shared with everything else on this
host. Set `GITHUB_TOKEN` in the runner's environment if that ever bites.
