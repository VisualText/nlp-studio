# The try page

`/studio/try/` is a page where someone who has never installed anything picks one of
VisualText's analyzers, types some text, presses **Run**, and sees what the analyzer did
with it: the pass sequence, the knowledge base, the files the run wrote, the parse trees,
and — with **Log files** ticked — each pass's own tree and the text marked with what that
pass's rules matched.

It is a second page in the phase-2 studio, not a separate service. It is built from the
same `studio/` project into the same `dist/`, shipped in the same container, and it calls
the same `/studio/api/`. If `/studio/` works, it works.

It is deliberately **read-only**: the analyzers are chosen and copied in when the image is
built, and the only thing a visitor can change is the text. That is the whole reason it can
be opened to people who are not invited, and [§ Why it needs no sandbox](#why-it-needs-no-sandbox)
is the argument in full. Read that before changing what the page accepts.

Related documents:

| | |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md#trying-an-analyzer-without-that-sandbox-implemented) | why this design, next to *The run server is not a sandbox* |
| [studio/deploy/INSTALL.md](../studio/deploy/INSTALL.md#the-try-page) | operating it on studio.visualtext.org, and what opening it wider needs |
| [analyzer-views/README.md](../analyzer-views/README.md) | the seven elements the page is drawn with |

## Why it needs no sandbox

Running an analyzer is running its author's code. NLP++ has file functions that take any
path (`openfile`, `readfile`, `mkdir`, …) and they cannot be refused — the knowledge-base
library every template ships uses them. `ARCHITECTURE.md` says plainly that before
strangers can run *their own* analyzers, the operating system has to contain the run
process, and that this is not built.

The try page sidesteps that rather than solving it. **The visitor never supplies code.**
The analyzers come from a pinned `VisualText/analyzers` release, chosen by name in
`studio/scripts/copy-analyzers.mjs`, and the page offers no way to edit the NLP++. The text
is data the rules read, not rules the engine runs.

Two things have to stay true for that to hold, and neither is enforced by the server:

1. **The page stays read-only.** The moment it accepts a pasted grammar, an uploaded
   `.nlp`, or an analyzer named by URL, the code being run is a stranger's again and
   everything in *The run server is not a sandbox* applies.
2. **`/api/run` is still the general endpoint.** It accepts any `files` a caller sends —
   the restraint lives in the page, not in the server. Making the page reachable
   anonymously without also rate-limiting and fronting `/api/run` would put a remote code
   execution endpoint on the host that serves visualtext.org.

## Where the analyzers come from

`studio/scripts/copy-analyzers.mjs` runs before `npm run dev` and `npm run build`. It reads
a source tree of [VisualText/analyzers](https://github.com/VisualText/analyzers), copies the
picked analyzers' `spec/`, `kb/` and `input/` into `studio/public/try/analyzers/<slug>/`,
and writes an `index.json` beside them. The page fetches those as ordinary static files:
no GitHub API at run time, no token, no rate limit, and nothing user-controlled in the
grammar.

The source is either of two things, and the distinction matters:

- **A release's `analyzers.zip`, unpacked** — what the Dockerfile uses. This is the same
  bundle VisualText itself downloads as its example analyzers, so the page offers exactly
  the set a VisualText user has. `VISUALTEXT_ANALYZERS_TAG` names the release and ends up
  on the image as the `org.visualtext.analyzers` label. **The zip holds only the five
  bundled entries** (`corporate/`, `files/`, `parse-en-us/`, `nlp-tutorials/`,
  `nlpfix-analyzers/`), so anything outside them cannot be picked.
- **A git checkout**, for working on this locally. Three of the five entries are
  submodules, so clone with `--recurse-submodules` or the tutorials and the NLPFix
  analyzers will not be there. `VISUALTEXT_ANALYZERS` points at it; the default is
  `../../analyzers`, a sibling of this repo.

Only `spec/`, `kb/` and `input/` travel — never `output/`, `tmp/` or an engine run's
`*_log/`, which are a previous run's leavings and would otherwise be read back as though
this page's run had written them. Files over 1 MB are skipped; see
`studio/scripts/analyzer-files.mjs`, which both copy scripts share so they cannot drift on
what an analyzer is.

`studio/public/try/` is generated and git-ignored. It is not committed: it is build output,
and a second copy of another repository besides.

## Which analyzers, and why

Eight of the twenty in the bundle, each showing something the others do not. Together they
come to 259 files and 1.45 MB — small enough to be fetched into a tab.

| On the page | From | Files | Size | Passes | Shows |
|---|---|---|---|---|---|
| **Corporate** | `corporate` | 43 | 132K | 30 | Companies, money and events, with pronouns resolved back to what they refer to. The showcase analyzer. |
| **Regions** | `nlp-tutorials/tutorial-07` | 10 | 38K | 5 | Where NLP++ code, functions and rules live in a pass — and what a code-only pass matches. |
| **Dates and Times** | `nlpfix-analyzers/date-time` | 48 | 273K | 17 | Dates and times in many formats, where a regular expression needs rewriting for each. Four `.dict` files, and the only one that writes an `output.json`. |
| **Formatting** | `nlpfix-analyzers/formatting` | 66 | 225K | 26 | Recovers headings, lists and tables from text that lost its formatting. |
| **Entities** | `nlpfix-analyzers/nlp` | 45 | 661K | 17 | Gathers what a text says about each person or thing into one record. Writes eight files. |
| **Variables** | `nlp-tutorials/tutorial-02` | 17 | 49K | 12 | The five NLP++ variables — N, S, X, G and L — on a short résumé. |
| **Pronouns** | `nlp-tutorials/tutorial-08` | 19 | 51K | 14 | Builds a knowledge base from the text as it reads, then resolves pronouns with it. |
| **Ambiguity** | `nlp-tutorials/tutorial-15` | 11 | 53K | 4 | Choosing between readings of the same words, with a `.dict` and a `.kbb` file. |

Two things about this set that are worth knowing before changing it.

**Most of these analyzers have an empty knowledge base panel.** `<nlp-knowledge-base>`
lists `.dict` and `.kbb` files and never the engine's own `.kb` files, which is correct and
is the rule the package exists to keep. But only *Dates and Times*, *Entities* and
*Ambiguity* ship any — Corporate, for all that it is the knowledge-base showcase, has six
`.kb` files and no `.dict` or `.kbb`, so its panel hides itself. That is the truth about
those analyzers, not a bug in the view.

**`<nlp-values>` is not the answer here.** The reference implementation this page was
modelled on leads with the fields an `output.json` filled. Of VisualText's analyzers only
*Dates and Times* writes one at all; the rest write `.txt` and `.kbb` files. So the right
column leads with **what the run wrote** and the parse trees, and `<nlp-values>` appears
only when there is an `output.json` to show.

### What is left out, and why

| Left out | Why |
|---|---|
| `parse-en-us` | **Refused by the run server**: it calls `interactive()`, which `nlp_run.BLOCKED` lists alongside the desktop app's popups. See [§ Open questions](#open-questions) — this one is probably worth revisiting. 4.6 MB besides. |
| `nlp-tutorials/tutorial-01` | 26 MB, over the run server's 8 MB `MAX_FILES_BYTES`, so it could be listed but never run. All of it is `kb/user/attr*.kb` and `word.kb` — engine `.kb` dumps, which are not listed in the knowledge base anyway — for a sequence of one `dicttokz` pass. The weakest demo in the set regardless. |
| `business` | Runs fine, and is one of the few analyzers with a visible knowledge base (2 `.dict`, 1 `.kbb`) — but it is **not in `analyzers.zip`**, only in the repository, so a build from a release cannot see it. It also covers much the same ground as Corporate. |
| `files` | Walks a directory of files keeping a knowledge base across them. On a page that runs one text at a time, the point of it does not come across. |
| the other tutorials | They run, but each overlaps one of the eight above. `tutorial-13-b` reports 14 problems, which would exercise `<nlp-log>` nicely but is not something to ship as a demo. |

### The survey this came from

Every analyzer in the repository, run through `POST /api/run` with `develop: true`, engine
NLPPlus 2.2.38. Recorded here so nobody has to do it again. `out` is files written, `prob`
problems reported, `trees` parse trees kept.

| Analyzer | MB | Status | out | prob | trees |
|---|---|---|---|---|---|
| `business` | 0.06 | ok | 4 | 0 | 26 |
| `corporate` | 0.13 | ok | 5 | 0 | 29 |
| `files` | 0.14 | ok | 1 | 0 | 8 |
| `nlp-tutorials/tutorial-01` | 26.08 | **too big** — over the 8 MB limit | | | |
| `nlp-tutorials/tutorial-02` | 0.05 | ok | 3 | 0 | 13 |
| `nlp-tutorials/tutorial-03` | 0.05 | ok | 3 | 0 | 13 |
| `nlp-tutorials/tutorial-04` | 0.04 | ok | 1 | 2 | 5 |
| `nlp-tutorials/tutorial-05` | 0.04 | ok | 0 | 1 | 10 |
| `nlp-tutorials/tutorial-06` | 0.05 | ok | 3 | 0 | 14 |
| `nlp-tutorials/tutorial-07` | 0.04 | ok | 2 | 0 | 6 |
| `nlp-tutorials/tutorial-08` | 0.05 | ok | 5 | 0 | 15 |
| `nlp-tutorials/tutorial-09` | 0.04 | ok | 0 | 0 | 13 |
| `nlp-tutorials/tutorial-11` | 0.04 | ok | 1 | 0 | 5 |
| `nlp-tutorials/tutorial-13/tutorial-13-a` | 0.04 | ok | 1 | 0 | 4 |
| `nlp-tutorials/tutorial-13/tutorial-13-b` | 0.05 | ok | 0 | 14 | 20 |
| `nlp-tutorials/tutorial-14` | 0.04 | ok | 1 | 0 | 5 |
| `nlp-tutorials/tutorial-15` | 0.05 | ok | 2 | 0 | 5 |
| `nlpfix-analyzers/date-time` | 0.27 | ok | 3 | 0 | 18 |
| `nlpfix-analyzers/formatting` | 0.22 | ok | 3 | 0 | 27 |
| `nlpfix-analyzers/nlp` | 1.82 | ok | 8 | 0 | 18 |
| `parse-en-us` | 4.58 | **rejected** — `interactive()` | | | |

## How the page is put together

| File | |
|---|---|
| `studio/try/index.html` | the page: a top bar and three columns |
| `studio/src/try/main.ts` | loading an analyzer, running it, and wiring the views' events |
| `studio/src/try/result.ts` | pure: turning a run result into what the views take, with tests in `studio/test/try.test.ts` |
| `studio/src/try/try.css` | the three-column layout |
| `studio/src/theme.css` | the palette and plain controls, shared with the studio page so a colour is changed once |
| `studio/scripts/copy-analyzers.mjs` | the catalog, at build time |
| `studio/scripts/analyzer-files.mjs` | what travels with an analyzer, shared with `copy-samples.mjs` |

The layout is three columns that fill the window, each scrolling on its own so the page
never does: the sequence over the knowledge base on the left; whatever was clicked — a
pass, a dictionary, a tree, an output file — in the middle; the text and the results on the
right. Under 900px they stack.

Every list is a `@visualtext/analyzer-views` element, which is the point: a pass is numbered
and a knowledge base filtered here exactly as in the VS Code extension, because it is the
same code. Nothing about an analyzer is drawn by hand.

### Four things that will bite

- **Pass numbering.** A switched-off pass (`/nlp foo`) keeps its number and writes no tree;
  a `folder` or `stub` takes no number at all. `passes()` gets this right, and both cases
  are live in the shipped set — `business` has the first, `corporate` the second — so
  anything that renumbers by itself will mislabel every tree and every problem. `passTrees()`
  also keeps `final.tree` away from `<nlp-sequence>`: it was written after the last pass but
  belongs to none, and handing it over puts the icons on whichever pass is numbered `null`.
- **Mark the matches over the text that ran.** `ruleMatches(tree, text)` is given
  `state.ranText`, a copy kept beside the result — not the contents of the box, which may
  have been edited since. The page has no way to notice that going wrong.
- **A pass that is all `@CODE` matches nothing**, and its tree is a header alone, so its
  matches are the plain text. That is the truth about that pass. *Variables* and *Pronouns*
  have several. Do not "fix" it.
- **`size` and `bytes`.** The run server calls a tree's size `size`; the views call it
  `bytes`. `viewTrees()` is the one place that translates, and there is a test pinning it.
  Similarly `readOutput()` answers a `{ output }` wrapper while `<nlp-values>` wants the
  parsed value itself — pass the wrapper and every field is listed as `output.something`.

Trees are not sent with a run's result; they get large. The server keeps them for half an
hour and the page fetches one when it is opened (`GET /api/run/tree`). A tree too large to
keep comes back in `trees.skipped`, and `<nlp-trees>` says so rather than offering a button
that does nothing.

Every outcome of a run is a status **and a sentence**, including "no run server", and the
page shows the sentence. A page that says nothing when the server is down is the bug that
keeps coming back.

## Building and verifying

```bash
# a source of analyzers: a checkout ...
git clone --recurse-submodules https://github.com/VisualText/analyzers.git ../analyzers
# ... or a release, as the Dockerfile does
curl -fsSL -o /tmp/analyzers.zip \
  https://github.com/VisualText/analyzers/releases/latest/download/analyzers.zip
unzip -q /tmp/analyzers.zip -d /tmp/analyzers
export VISUALTEXT_ANALYZERS=/tmp/analyzers VISUALTEXT_ANALYZERS_TAG=v1.9.7

cd studio
npm run analyzers      # write public/try/analyzers/ and its index.json
npm run dev            # http://localhost:5173/try/
npm test               # includes test/try.test.ts
```

`npm run build` writes both pages into `dist/`; `python server/app.py --dist dist` serves
the site and the API from one address, and the try page is then at `/try/`.

The checks that matter run in `studio/deploy/smoke-test.sh`, against the image, under the
restrictions it runs live with: that `/try/` is the try page, that its `index.json` lists
analyzers and says which release they came from, and that one of them runs in debug mode,
keeps a tree after every pass, and can have one of those trees fetched back. Extend that
rather than testing by hand.

## Open questions

- **`interactive()` costs us the English parser.** It is in `nlp_run.BLOCKED` with
  `exittopopup` and `getpopupdata`, but at both of its call sites in `parse-en-us` it is a
  read-only predicate — `ini.nlp` uses it to decide whether to keep a worklog, `buff_out.nlp`
  to choose `out.xml` over `cbuf()` — and in both the `false` branch is the *safer* one, with
  no `openfile` and an in-memory buffer. Unblocking it would very likely make `parse-en-us`
  runnable, and it is the analyzer most people would want to try. It needs someone to decide
  that deliberately, and to confirm the run, before the list changes.
- **`VisualText/analyzers` has no LICENSE file.** This page redistributes its contents to
  every visitor. `.gitignore` already declines to commit the copy, for the same reason it
  declines to commit `analyzer-templates`, but the underlying question is the owner's to
  settle.
- **Rate limiting is not written.** Nothing here limits how often `/api/run` can be called.
  `--max-runs` caps concurrency and the timeout caps a single run, but a `limit_req` in front
  is a prerequisite for opening the page to the internet, not an improvement on it.
