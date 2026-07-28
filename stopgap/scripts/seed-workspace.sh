#!/usr/bin/env bash
#
# Seed /home/workspace with analyzers so the extension's views have content the
# moment the folder opens. The extension treats the workspace folder as a
# container of analyzer folders (visualText.getAnalyzers scans it), so each entry
# here is a complete analyzer directory -- spec/, kb/, input/ and all.
#
set -euo pipefail

EXT_DIR="${1:?usage: seed-workspace.sh <extensions-dir> <workspace-dir>}"
WORKSPACE="${2:?usage: seed-workspace.sh <extensions-dir> <workspace-dir>}"

ext_home="$(find "$EXT_DIR" -maxdepth 1 -type d -name 'dehilster.nlp-*' | sort -V | tail -n 1)"
engine="$ext_home/nlp-engine"

mkdir -p "$WORKSPACE"

copy_in() {   # copy_in <source dir> -- copies its children into the workspace
    local src="$1"
    [ -d "$src" ] || { echo "seed-workspace: skip missing $src"; return 0; }
    find "$src" -mindepth 1 -maxdepth 1 -type d -print0 \
        | while IFS= read -r -d '' d; do
            name="$(basename "$d")"
            case "$name" in
                .*) continue ;;                     # .git, .github, .vscode
            esac
            [ -d "$d/spec" ] || continue            # only real analyzers
            echo "  + $name"
            cp -a "$d" "$WORKSPACE/$name"
        done
}

echo "seed-workspace: copying tutorials"
copy_in "$engine/analyzers/nlp-tutorials"

echo "seed-workspace: copying starter templates"
for t in "Bare Minimum" "Telephone Numbers" "Email Addresses" "Date and Times" "URLs"; do
    src="$engine/visualText/analyzer-templates/$t"
    if [ -d "$src/spec" ]; then
        echo "  + $t"
        cp -a "$src" "$WORKSPACE/$t"
    else
        echo "  skip missing template: $t"
    fi
done

count="$(find "$WORKSPACE" -mindepth 1 -maxdepth 1 -type d | wc -l)"
echo "seed-workspace: $count analyzers in $WORKSPACE"
[ "$count" -gt 0 ] || { echo "seed-workspace: nothing seeded" >&2; exit 1; }
