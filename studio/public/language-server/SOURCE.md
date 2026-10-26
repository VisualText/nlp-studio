# browserServer.js

The NLP++ language server built for a Web Worker. It is `dist/browserServer.js` from
[VisualText/vscode-nlp](https://github.com/VisualText/vscode-nlp), production build, at
tag `v4.3.16` (`4ea9e22c`). It has the same handlers as the extension's language
server.

The page sends it the analyzer's files with the `nlp/workspaceFiles` notification; see
`src/server/browserServer.ts` and `memoryFiles.ts` in that repository.

**Committed, not built here.** When vscode-nlp releases, the Language server workflow
(`.github/workflows/language-server.yml`) builds it from the new tag and opens a pull
request. To update by hand, in a vscode-nlp checkout:

```bash
npm ci
npx webpack --mode production --config-name browserServer
cp dist/browserServer.js ../nlp-studio/studio/public/language-server/
```

Then change the tag and commit above; the workflow finds them there.
