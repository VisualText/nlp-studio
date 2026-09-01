#!/usr/bin/env bash
#
# Download a published dehilster.nlp vsix into stopgap/vsix/vscode.nlp.vsix,
# where the Dockerfile expects it.
#
# This is the automated counterpart to build-vsix.sh. That script packages the
# extension from a local vscode-nlp checkout, which is what you want while
# developing the extension. For updating the live site you want the version that
# was actually released, so this fetches the release asset instead -- no node
# toolchain, no checkout, and no chance of shipping whatever happened to be on
# a working branch.
#
# The asset is named nlp-<version>.vsix, so there is no fixed
# releases/latest/download/ URL for it; the tag has to be resolved through the
# API first.
#
# Usage:  fetch-vsix.sh [tag]        tag defaults to the latest release
#
# Prints the resolved tag on stdout (and nothing else) so callers can capture it:
#     tag="$(fetch-vsix.sh)"
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stopgap="$(dirname "$here")"
repo="https://api.github.com/repos/VisualText/vscode-nlp/releases"
tag="${1:-}"

# GITHUB_TOKEN is optional. Unauthenticated API calls are limited to 60/hour per
# IP, shared with everything else on this host; a nightly run is nowhere near
# that, but a token makes the limit 5000 if these ever run more often.
auth=()
[ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")

url="$repo/latest"
[ -n "$tag" ] && url="$repo/tags/$tag"

json="$(curl -fsSL --retry 3 --retry-delay 2 "${auth[@]}" \
    -H 'Accept: application/vnd.github+json' "$url")" || {
    echo "fetch-vsix: cannot reach $url" >&2
    exit 1
}

# Pull the tag and the .vsix asset out in one pass. Fail loudly on a release
# with no vsix rather than silently leaving a stale one in place -- that would
# build an image labelled with the new tag but containing the old extension.
read -r resolved_tag asset_url < <(printf '%s' "$json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
vsix = [a for a in d.get("assets", []) if a["name"].endswith(".vsix")]
if not vsix:
    sys.exit("fetch-vsix: release %s publishes no .vsix asset" % d.get("tag_name"))
if len(vsix) > 1:
    sys.exit("fetch-vsix: release %s publishes %d .vsix assets, expected 1: %s"
             % (d.get("tag_name"), len(vsix), ", ".join(a["name"] for a in vsix)))
print(d["tag_name"], vsix[0]["browser_download_url"])
')

mkdir -p "$stopgap/vsix"
out="$stopgap/vsix/vscode.nlp.vsix"

# Download beside the target and move into place, so an interrupted download
# cannot leave a truncated vsix that the next build would happily install.
tmp="$(mktemp "$out.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
curl -fsSL --retry 3 --retry-delay 2 "${auth[@]}" -o "$tmp" "$asset_url"

# A vsix is a zip. Anything else means we fetched an error page.
unzip -tqq "$tmp" >/dev/null 2>&1 || {
    echo "fetch-vsix: downloaded file is not a valid zip: $asset_url" >&2
    exit 1
}

mv "$tmp" "$out"
trap - EXIT

echo "fetch-vsix: $resolved_tag -> $out ($(du -h "$out" | cut -f1))" >&2
printf '%s\n' "$resolved_tag"
