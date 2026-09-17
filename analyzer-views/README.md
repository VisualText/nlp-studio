# @visualtext/analyzer-views

This package shows an NLP++ analyzer's pass sequence, knowledge base, run results, code and log the same way the
[NLP++ extension for VS Code](https://github.com/VisualText/vscode-nlp) does, on any web page.
It works with plain DOM code, React or any other framework.

It exists so that every page that lists an analyzer does it the same way. NLP Studio uses it
today, and the admin console's Browse and run is next. A rule is changed once, here: for
example, the knowledge base lists only `.dict` and `.kbb` files, never the engine's `.kb`
files.

## Use

```js
import "@visualtext/analyzer-views/style.css";
import "@visualtext/analyzer-views";          // defines the six <nlp-*> elements

const sequence = document.createElement("nlp-sequence");
sequence.files = ["spec/analyzer.seq", "spec/funcs.nlp", "kb/user/hier.kb", "kb/user/colors.dict"];
sequence.sequence = analyzerSeqText;         // the text of spec/analyzer.seq
sequence.addEventListener("nlp-open", (e) => openFile(e.detail.path));

const kb = document.createElement("nlp-knowledge-base");
kb.files = [{ path: "kb/user/colors.dict", bytes: 3000 }];   // sizes are optional
kb.addEventListener("nlp-open", (e) => openFile(e.detail.path));

sidebar.append(sequence, kb);
```

| Element | Lists | Extension view |
|---|---|---|
| `<nlp-sequence>` | The passes in `analyzer.seq`, numbered as the engine numbers them | Analyzer sequence |
| `<nlp-knowledge-base>` | The `.dict` and `.kbb` files under `kb/` | KB |
| `<nlp-output>` | The files a run wrote, by name | Output files |
| `<nlp-trees>` | A run's parse trees: `final.tree`, then the tree after each pass | Output files (trees) |
| `<nlp-code>` | One file's text, read-only, colored by NLP++'s grammars | The editor's coloring |
| `<nlp-log>` | A run's problems, each opening its pass at its line, then the log's lines | Logging |

Every list element takes:

| | |
|---|---|
| `files` (property) | The paths to list: strings, or `{ path, bytes }` objects to show sizes. `<nlp-trees>` takes `trees` instead. |
| `selected` (property) | The path that's open now, drawn as selected. |
| `changed` (property) | Paths with unsaved edits. Each gets a mark, plus a revert button when the element has `revertable`. |
| `heading` (attribute) | The list's heading. `heading=""` shows no heading. |
| `revertable` (attribute) | Show a revert button on changed files. |
| `nlp-open` (event) | A file was clicked. The path is in `event.detail.path` (a tree's name for `<nlp-trees>`). |
| `nlp-revert` (event) | A file's revert button was clicked. |

`<nlp-sequence>` also takes `sequence`, the text of `spec/analyzer.seq`. Its `passes`
property returns the passes it read from that text.

`<nlp-trees>` takes `trees`, as `{ name, pass, passName, bytes }` objects where `pass` is
`null` for `final.tree`, and `skipped`, the names of trees too large to keep:

```js
const trees = document.createElement("nlp-trees");
trees.trees = [{ name: "final.tree", pass: null, bytes: 42000 }, { name: "ana001.tree", pass: 1, passName: "tokenize" }];
trees.skipped = ["ana003.tree"];
trees.addEventListener("nlp-open", (e) => openTree(e.detail.path));
```

`<nlp-code>` takes `text`, and `path` to pick the grammar by the file's name. A
`language` attribute (`nlp`, `seq`, `kb`, `kbb`, `dict`, `tree`, `txxt`) overrides the path:

```js
const code = document.createElement("nlp-code");
code.path = "output/final.tree";
code.text = treeText;
```

The text shows plain at once, then colored when the grammars have loaded. Loading happens
once per page, on first use, as separate chunks. A file that isn't NLP++, or is longer than
200,000 characters, stays plain. Tokens are rendered as text; the file is never parsed as
HTML. Give the element a height and it scrolls. Set `line` (from 1) to mark a line and scroll it
into view, for example the line a problem is on.

The grammars are the NLP++ extension's, from
[nlpplus-tmbundle](https://github.com/VisualText/nlpplus-tmbundle) (`src/grammars/`). The
colors are the extension's too: its `editor.tokenColorCustomizations` rules for scopes that
stock themes don't know, such as tree nodes, rewrites and KB concepts, added to `light-plus`
and `dark-plus`. NLP Studio's Monaco editor uses the same highlighter
(`nlpHighlighter()`), so a file reads the same there.

`<nlp-log>` takes `problems`, as `{ file, pass, line, message }`, and `lines`, the log as text or
an array. A problem whose pass has a file raises `nlp-open` with `detail.path` and
`detail.line`. A page that has the engine's log text rather than problems gets them from
`problemsInLog(logText, seqText, paths)`, which reads the log as NLP Studio's run server does:

```js
const log = document.createElement("nlp-log");
log.problems = problemsInLog(errLog, seqText, paths);
log.lines = errLog;
log.addEventListener("nlp-open", (e) => openFile(e.detail.path, e.detail.line));
```

A list element with nothing to list hides itself, and so does `<nlp-log>`. The rows are ordinary light DOM, so a page can
style them, query them (`button[data-path]`) and test them.

**React 18** passes attributes but not properties to custom elements. Set `files`,
`sequence`, `selected` and `changed` through a ref.

## Theme

`style.css` provides the extension's icon colors for light and dark. It follows
`prefers-color-scheme` unless `<html>` has `data-theme="light"` or `data-theme="dark"`. To
match a page's own colors, set these properties on any element around the lists:
`--nlp-muted`, `--nlp-hover`, `--nlp-selected`, `--nlp-selected-ink`, `--nlp-changed`,
`--nlp-font`, `--nlp-error`, `--nlp-line`, and `--nlp-icon-dna`, `--nlp-icon-dict` and the other icon colors. Code colors
follow the same light and dark choice.

## The rules alone

`@visualtext/analyzer-views/rules` has no DOM, so a server can use it too:

- `passes(seqText, files)` reads `analyzer.seq` into passes, numbered the way the engine
  numbers them. A switched-off pass keeps its number, and a folder or stub gets none.
- `shownInKnowledgeBase(path)` says whether a file is listed in the knowledge base.
- `passTooltip`, `passLabel`, `passIcon`, `fileIcon` and `fileSize` give each row's
  mouse-over, label, icon and size.
- `outputOrder`, `treeOrder`, `treeLabel`, `treeTitle` and `treeNote` order and describe
  what a run wrote.
- `langFor(path)` names the grammar for a file, and `LIGHT_RULES` and `DARK_RULES` are the
  extension's token colors.
- `problemsIn`, `problemsInLog`, `problemWhere` and `logLines` read the engine's `err.log` and
  `make_ana.log`.

## Develop

```bash
npm install
npm test          # the rules, and the elements in happy-dom
npm run check     # types
npm run build     # dist/, which NLP Studio imports
```

NLP Studio depends on this package as `file:../analyzer-views` and rebuilds it before
`dev`, `build` and `test`.

The icons are from the NLP++ extension (vscode-nlp/resources, MIT, Amnon Meyers and David de
Hilster).
