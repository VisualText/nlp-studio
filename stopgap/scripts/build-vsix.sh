#!/usr/bin/env bash
#
# Package the dehilster.nlp extension from a sibling vscode-nlp checkout into
# stopgap/vsix/vscode.nlp.vsix, where the Dockerfile expects it.
#
# The extension is not published to Open VSX (which is the marketplace
# openvscode-server talks to), so building the vsix locally is the only way to
# get it into the image.
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stopgap="$(dirname "$here")"
src="${VSCODE_NLP_DIR:-$(cd "$stopgap/../.." && pwd)/vscode-nlp}"

[ -d "$src" ] || {
    echo "build-vsix: vscode-nlp checkout not found at $src" >&2
    echo "            set VSCODE_NLP_DIR to override" >&2
    exit 1
}

echo "build-vsix: source = $src"
cd "$src"

[ -d node_modules ] || npm ci
npm run vsce-package        # webpack --mode production && vsce package -o ./vscode.nlp.vsix

mkdir -p "$stopgap/vsix"
cp "$src/vscode.nlp.vsix" "$stopgap/vsix/vscode.nlp.vsix"
echo "build-vsix: wrote $stopgap/vsix/vscode.nlp.vsix"
