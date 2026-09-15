# browserServer.js

The NLP++ language server built for a Web Worker. It is `dist/browserServer.js` from
[VisualText/vscode-nlp](https://github.com/VisualText/vscode-nlp), production build, at
master `b4bd87f7` (4.2.0, PR #1208). It has the same handlers as the extension's language
server.

The page sends it the analyzer's files with the `nlp/workspaceFiles` notification; see
`src/server/browserServer.ts` and `memoryFiles.ts` in that repository.

**Committed, not built here.** Building it needs a vscode-nlp checkout and its npm
install. To update, in a vscode-nlp checkout:

```bash
npm ci
npx webpack --mode production --config-name browserServer
cp dist/browserServer.js ../nlp-studio/studio/public/language-server/
```

Then change the commit above.
