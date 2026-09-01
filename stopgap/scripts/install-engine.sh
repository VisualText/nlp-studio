#!/usr/bin/env bash
#
# Pre-bake the NLP++ engine into the installed extension's engine directory.
#
# The dehilster.nlp extension normally fetches all of this itself on first
# activation (the updater queue in vscode-nlp/src/visualText.ts). Doing it at image
# build time makes container start instant and offline-capable. The layout below
# mirrors exactly what that updater's CHECK_EXISTS ops look for, so on startup it
# finds everything present and queues no downloads:
#
#   <ext>/nlp-engine/nlp.exe                  NLP_EXE
#   <ext>/nlp-engine/data/rfb/                ENGINE_FILES     (nlpengine.zip)
#   <ext>/nlp-engine/include/, lib/           ENGINE_COMPILE_FILES
#   <ext>/nlp-engine/visualText/{spec,Help,analyzer-templates}   VT_FILES
#   <ext>/nlp-engine/analyzers/               ANALYZER_FILES
#
set -euo pipefail

EXT_DIR="${1:?usage: install-engine.sh <extensions-dir>}"
GH="https://github.com/VisualText"

# Release tags to install. Left unset each resolves to whatever "latest" is at
# the moment curl runs, which is fine for a hand build. update-studio.sh instead
# resolves the tags once up front and pins them here, for two reasons: the image
# can be labelled with exactly what went into it, and a release published
# halfway through a build cannot produce an image with mismatched parts.
NLP_ENGINE_TAG="${NLP_ENGINE_TAG:-latest}"
VISUALTEXT_FILES_TAG="${VISUALTEXT_FILES_TAG:-latest}"
ANALYZERS_TAG="${ANALYZERS_TAG:-latest}"

ext_home="$(find "$EXT_DIR" -maxdepth 1 -type d -name 'dehilster.nlp-*' | sort -V | tail -n 1)"
if [ -z "$ext_home" ]; then
    echo "install-engine: no dehilster.nlp-* directory under $EXT_DIR" >&2
    exit 1
fi

engine="$ext_home/nlp-engine"
mkdir -p "$engine"
echo "install-engine: engine directory = $engine"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() {   # fetch <repo> <asset> <tag>; downloads to $tmp/<asset>
    local repo="$1" asset="$2" tag="$3" url
    if [ "$tag" = latest ]; then
        url="$GH/$repo/releases/latest/download/$asset"
    else
        url="$GH/$repo/releases/download/$tag/$asset"
    fi
    echo "install-engine: fetching $repo@$tag/$asset"
    curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/$asset" "$url"
}

# --- nlp.exe -------------------------------------------------------------------
# Mirrors visualText.linuxZipName(): the engine ships one binary per Ubuntu
# release and picking the wrong one gives a glibc/ICU mismatch at runtime. Read
# the ACTUAL base image release rather than assuming, so this keeps working if
# gitpod/openvscode-server rebases.
zip_name="ubuntu-latest.zip"
if [ -r /etc/os-release ]; then
    version_id="$(sed -n 's/^VERSION_ID="\?\([^"]*\)"\?$/\1/p' /etc/os-release)"
    case "$version_id" in
        20.04) zip_name="ubuntu-20.04.zip" ;;
        22.04) zip_name="ubuntu-22.04.zip" ;;
    esac
fi
echo "install-engine: base image VERSION_ID=${version_id:-unknown} -> $zip_name"

fetch nlp-engine "$zip_name" "$NLP_ENGINE_TAG"
unzip -q -o "$tmp/$zip_name" -d "$tmp/exe"
# The exe zips wrap their payload in a single <ubuntu-xx>/ subfolder and name the
# binary nlpl.exe; flatten and rename, exactly as the extension's unzip() does.
src="$tmp/exe"
[ -d "$tmp/exe/${zip_name%.zip}" ] && src="$tmp/exe/${zip_name%.zip}"
cp -a "$src/." "$engine/"
mv "$engine/nlpl.exe" "$engine/nlp.exe"
chmod 755 "$engine/nlp.exe"

# --- engine data (data/rfb) ----------------------------------------------------
fetch nlp-engine nlpengine.zip "$NLP_ENGINE_TAG"
unzip -q -o "$tmp/nlpengine.zip" -d "$engine"

# --- compile libs (include/, lib/) ---------------------------------------------
# Baked in even though the stopgap runs interpreted: the updater checks for these
# on every startup and would otherwise re-download ~15 MB each time a container
# starts.
fetch nlp-engine nlpengine-compile-libs.zip "$NLP_ENGINE_TAG"
unzip -q -o "$tmp/nlpengine-compile-libs.zip" -d "$engine"

# --- VisualText files ----------------------------------------------------------
# Goes under visualText/ (not visualtext-files/) -- that is the path the updater
# writes to and validates.
fetch visualtext-files visualtext.zip "$VISUALTEXT_FILES_TAG"
mkdir -p "$engine/visualText"
unzip -q -o "$tmp/visualtext.zip" -d "$engine/visualText"

# --- sample analyzers ----------------------------------------------------------
fetch analyzers analyzers.zip "$ANALYZERS_TAG"
mkdir -p "$engine/analyzers"
unzip -q -o "$tmp/analyzers.zip" -d "$engine/analyzers"

# --- verify --------------------------------------------------------------------
echo "install-engine: verifying layout"
missing=0
for p in nlp.exe data/rfb include lib visualText/spec visualText/Help \
         visualText/analyzer-templates analyzers; do
    if [ -e "$engine/$p" ]; then
        echo "  ok      $p"
    else
        echo "  MISSING $p" >&2
        missing=1
    fi
done
[ "$missing" -eq 0 ] || { echo "install-engine: incomplete engine layout" >&2; exit 1; }

echo "install-engine: nlp.exe reports version: $("$engine/nlp.exe" --version 2>&1 | tail -n 1)"

# Leave a record inside the image. The same values go on the image as labels
# (see the Dockerfile), which is what update-studio.sh compares against; this
# file is for reading from inside a running container.
cat > "$engine/.nlp-studio-versions" <<EOF
nlp-engine=$NLP_ENGINE_TAG
visualtext-files=$VISUALTEXT_FILES_TAG
analyzers=$ANALYZERS_TAG
installed=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

echo "install-engine: done"
