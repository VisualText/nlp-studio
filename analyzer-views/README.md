# @visualtext/analyzer-views

This package shows an NLP++ analyzer's pass sequence and knowledge base the same way the
[NLP++ extension for VS Code](https://github.com/VisualText/vscode-nlp) does, on any web page.
It works with plain DOM code, React or any other framework.

It exists so that every page that lists an analyzer does it the same way. NLP Studio uses it
today, and the admin console's Browse and run is next. A rule is changed once, here: for
example, the knowledge base lists only `.dict` and `.kbb` files, never the engine's `.kb`
files.

## Use

```js
import "@visualtext/analyzer-views/style.css";
import "@visualtext/analyzer-views";          // defines <nlp-sequence> and <nlp-knowledge-base>

const sequence = document.createElement("nlp-sequence");
sequence.files = ["spec/analyzer.seq", "spec/funcs.nlp", "kb/user/hier.kb", "kb/user/colors.dict"];
sequence.sequence = analyzerSeqText;         // the text of spec/analyzer.seq
sequence.addEventListener("nlp-open", (e) => openFile(e.detail.path));

const kb = document.createElement("nlp-knowledge-base");
kb.files = [{ path: "kb/user/colors.dict", bytes: 3000 }];   // sizes are optional
kb.addEventListener("nlp-open", (e) => openFile(e.detail.path));

sidebar.append(sequence, kb);
```

Both elements take:

| | |
|---|---|
| `files` (property) | The analyzer's paths: strings, or `{ path, bytes }` objects to show sizes. |
| `selected` (property) | The path that's open now, drawn as selected. |
| `changed` (property) | Paths with unsaved edits. Each gets a mark, plus a revert button when the element has `revertable`. |
| `heading` (attribute) | The list's heading. `heading=""` shows no heading. |
| `revertable` (attribute) | Show a revert button on changed files. |
| `nlp-open` (event) | A file was clicked. The path is in `event.detail.path`. |
| `nlp-revert` (event) | A file's revert button was clicked. |

`<nlp-sequence>` also takes `sequence`, the text of `spec/analyzer.seq`. Its `passes`
property returns the passes it read from that text.

An element with nothing to list hides itself. The rows are ordinary light DOM, so a page can
style them, query them (`button[data-path]`) and test them.

**React 18** passes attributes but not properties to custom elements. Set `files`,
`sequence`, `selected` and `changed` through a ref.

## Theme

`style.css` provides the extension's icon colors for light and dark. It follows
`prefers-color-scheme` unless `<html>` has `data-theme="light"` or `data-theme="dark"`. To
match a page's own colors, set these properties on any element around the lists:
`--nlp-muted`, `--nlp-hover`, `--nlp-selected`, `--nlp-selected-ink`, `--nlp-changed`,
`--nlp-font`, and `--nlp-icon-dna`, `--nlp-icon-dict` and the other icon colors.

## The rules alone

`@visualtext/analyzer-views/rules` has no DOM, so a server can use it too:

- `passes(seqText, files)` reads `analyzer.seq` into passes, numbered the way the engine
  numbers them. A switched-off pass keeps its number, and a folder or stub gets none.
- `shownInKnowledgeBase(path)` says whether a file is listed in the knowledge base.
- `passTooltip`, `passLabel`, `passIcon`, `fileIcon` and `fileSize` give each row's
  mouse-over, label, icon and size.

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
