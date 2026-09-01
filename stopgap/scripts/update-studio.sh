#!/usr/bin/env bash
#
# Keep studio.visualtext.org current with upstream releases.
#
# Compares the release tags baked into the live image against the latest
# releases of vscode-nlp, nlp-engine, visualtext-files and analyzers. If
# anything moved: build a candidate image, smoke-test it, and only then swap it
# in. The previous image is kept as nlp-studio:previous, and a candidate that
# passes its own tests but fails to serve after the swap is rolled back
# automatically.
#
# Designed to be safe to run from cron unattended:
#   - does nothing at all when everything is current (the common case)
#   - never touches the live container until the new image has been proven
#   - refuses to run twice at once
#   - a failed build or test leaves the running site completely untouched
#
# Usage:
#   update-studio.sh                 check, and update if anything is behind
#   update-studio.sh --check         report drift and exit; never builds
#   update-studio.sh --force         rebuild and swap even if nothing changed
#   update-studio.sh --no-swap       build and test a candidate, leave live alone
#
# Exit status:  0 nothing to do, or updated successfully
#               1 something went wrong (live site left on the working image)
#               2 --check only: an update is available
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOPGAP="$(dirname "$here")"

IMAGE_LIVE="nlp-studio:stopgap"
IMAGE_PREV="nlp-studio:previous"
IMAGE_NEW="nlp-studio:candidate"
SERVICE="nlp-studio"
HEALTH_URL="http://127.0.0.1:3000/"
WORKSPACE_VOLUME="stopgap_nlp-studio-workspace"
LOG_DIR="${NLP_STUDIO_LOG_DIR:-$STOPGAP/logs}"
LOG_KEEP_DAYS=30

MODE=update
for arg in "$@"; do
    case "$arg" in
        --check)   MODE=check   ;;
        --force)   MODE=force   ;;
        --no-swap) MODE=noswap  ;;
        -h|--help) sed -n '2,30p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "update-studio: unknown option $arg (try --help)" >&2; exit 1 ;;
    esac
done

# --- logging -------------------------------------------------------------------
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/update-$(date +%Y-%m).log"
exec > >(tee -a "$LOG_FILE") 2>&1
find "$LOG_DIR" -maxdepth 1 -name 'update-*.log' -mtime "+$LOG_KEEP_DAYS" -delete 2>/dev/null || true

say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
die() { say "ERROR: $*"; exit 1; }

# --- one at a time -------------------------------------------------------------
# A build takes several minutes. Without this a slow run and the next cron tick
# would fight over the same image tags.
exec 9>"$STOPGAP/.update.lock"
if ! flock -n 9; then
    say "another update is already running; nothing to do"
    exit 0
fi

say "=== update-studio ($MODE) ==="

# --- what upstream has ---------------------------------------------------------
auth=()
[ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")

latest_tag() {   # latest_tag <repo>
    curl -fsSL --retry 3 --retry-delay 2 "${auth[@]}" \
        -H 'Accept: application/vnd.github+json' \
        "https://api.github.com/repos/VisualText/$1/releases/latest" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])'
}

say "resolving latest releases"
# Resolved once, up front, and pinned into the build. If a release lands while
# the build is running it is simply picked up next time, rather than producing an
# image whose parts came from either side of it.
WANT_VSCODE_NLP="$(latest_tag vscode-nlp)"       || die "cannot reach GitHub (vscode-nlp)"
WANT_NLP_ENGINE="$(latest_tag nlp-engine)"       || die "cannot reach GitHub (nlp-engine)"
WANT_VT_FILES="$(latest_tag visualtext-files)"   || die "cannot reach GitHub (visualtext-files)"
WANT_ANALYZERS="$(latest_tag analyzers)"         || die "cannot reach GitHub (analyzers)"

# --- what we are running -------------------------------------------------------
label() {   # label <image> <label name>
    docker image inspect "$1" --format "{{index .Config.Labels \"$2\"}}" 2>/dev/null || true
}

if docker image inspect "$IMAGE_LIVE" >/dev/null 2>&1; then
    HAVE_VSCODE_NLP="$(label "$IMAGE_LIVE" org.visualtext.vscode-nlp)"
    HAVE_NLP_ENGINE="$(label "$IMAGE_LIVE" org.visualtext.nlp-engine)"
    HAVE_VT_FILES="$(label "$IMAGE_LIVE" org.visualtext.visualtext-files)"
    HAVE_ANALYZERS="$(label "$IMAGE_LIVE" org.visualtext.analyzers)"
else
    say "no $IMAGE_LIVE image yet -- treating everything as out of date"
fi
# Images built before this script existed carry no labels; empty reads as
# "unknown", which differs from any real tag and so triggers one rebuild.
: "${HAVE_VSCODE_NLP:=unknown}" "${HAVE_NLP_ENGINE:=unknown}"
: "${HAVE_VT_FILES:=unknown}" "${HAVE_ANALYZERS:=unknown}"

drift=0
report() {   # report <name> <have> <want>
    if [ "$2" = "$3" ]; then
        printf '  %-18s %-12s current\n' "$1" "$2"
    else
        printf '  %-18s %-12s -> %s\n' "$1" "$2" "$3"
        drift=1
    fi
}
report vscode-nlp       "$HAVE_VSCODE_NLP" "$WANT_VSCODE_NLP"
report nlp-engine       "$HAVE_NLP_ENGINE" "$WANT_NLP_ENGINE"
report visualtext-files "$HAVE_VT_FILES"   "$WANT_VT_FILES"
report analyzers        "$HAVE_ANALYZERS"  "$WANT_ANALYZERS"

if [ "$MODE" = check ]; then
    [ "$drift" -eq 0 ] && { say "up to date"; exit 0; }
    say "an update is available"
    exit 2
fi

if [ "$drift" -eq 0 ] && [ "$MODE" != force ]; then
    say "up to date; nothing to do"
    exit 0
fi

# --- build ---------------------------------------------------------------------
say "fetching extension $WANT_VSCODE_NLP"
GITHUB_TOKEN="${GITHUB_TOKEN:-}" "$here/fetch-vsix.sh" "$WANT_VSCODE_NLP" >/dev/null \
    || die "could not fetch the vsix for $WANT_VSCODE_NLP"

say "building $IMAGE_NEW"
# --pull so a rebased gitpod/openvscode-server base is picked up too; the engine
# binary is chosen by the base image's Ubuntu release, so that matters.
docker build \
    --pull \
    --build-arg "VSCODE_NLP_TAG=$WANT_VSCODE_NLP" \
    --build-arg "NLP_ENGINE_TAG=$WANT_NLP_ENGINE" \
    --build-arg "VISUALTEXT_FILES_TAG=$WANT_VT_FILES" \
    --build-arg "ANALYZERS_TAG=$WANT_ANALYZERS" \
    --build-arg "BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t "$IMAGE_NEW" \
    -f "$STOPGAP/Dockerfile" \
    "$STOPGAP" \
    || die "build failed -- live site untouched, still on $HAVE_VSCODE_NLP"

say "smoke-testing $IMAGE_NEW"
"$here/smoke-test.sh" "$IMAGE_NEW" \
    || die "candidate failed its smoke test -- live site untouched, still on $HAVE_VSCODE_NLP"

if [ "$MODE" = noswap ]; then
    say "candidate built and passed; leaving it as $IMAGE_NEW (--no-swap)"
    say "swap it in with: docker tag $IMAGE_NEW $IMAGE_LIVE && cd $STOPGAP && docker compose up -d"
    exit 0
fi

# --- swap ----------------------------------------------------------------------
had_previous=0
if docker image inspect "$IMAGE_LIVE" >/dev/null 2>&1; then
    docker tag "$IMAGE_LIVE" "$IMAGE_PREV"
    had_previous=1
fi
docker tag "$IMAGE_NEW" "$IMAGE_LIVE"

say "restarting the service"
cd "$STOPGAP"
docker compose up -d "$SERVICE" || {
    say "compose up failed"
    [ "$had_previous" -eq 1 ] && {
        docker tag "$IMAGE_PREV" "$IMAGE_LIVE"
        docker compose up -d "$SERVICE" || true
    }
    die "rolled back to the previous image"
}

# --- health check, and roll back if it is not serving ---------------------------
say "waiting for the site to answer"
ok=0
for i in $(seq 1 45); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
    [ "$code" = 200 ] && { ok=1; break; }
    sleep 2
done

if [ "$ok" -ne 1 ]; then
    say "the new image is not serving on $HEALTH_URL (last: ${code:-none})"
    docker compose logs --tail 40 "$SERVICE" || true
    if [ "$had_previous" -eq 1 ]; then
        say "rolling back to the previous image"
        docker tag "$IMAGE_PREV" "$IMAGE_LIVE"
        docker compose up -d "$SERVICE" || true
        die "rolled back; the site should be back on $HAVE_VSCODE_NLP"
    fi
    die "no previous image to roll back to -- the site is DOWN, investigate now"
fi
say "site is up (200 after ~$((i * 2))s)"

# --- top up the persisted workspace --------------------------------------------
# The workspace lives in a named volume so people's analyzers survive restarts.
# A named volume is only ever seeded from the image the first time it is used, so
# analyzers added to a newer analyzers release would otherwise never appear.
# Copy in only what is missing -- never overwrite, so nobody's edits are lost.
say "checking for new seeded analyzers"
docker run --rm --user root \
    -v "$WORKSPACE_VOLUME:/mnt/live" \
    --entrypoint /bin/bash "$IMAGE_LIVE" -c '
    added=0
    for d in /home/workspace/*/; do
        [ -d "$d/spec" ] || continue
        name="$(basename "$d")"
        if [ ! -e "/mnt/live/$name" ]; then
            cp -a "$d" "/mnt/live/$name"
            echo "  + $name"
            added=$((added+1))
        fi
    done
    [ "$added" -eq 0 ] && echo "  (none new)"
    exit 0
' || say "WARNING: could not top up the workspace volume (site is fine; seeded analyzers may be stale)"

# --- tidy ----------------------------------------------------------------------
docker image rm "$IMAGE_NEW" >/dev/null 2>&1 || true   # the tag, not the image; :stopgap holds it
docker image prune -f >/dev/null 2>&1 || true          # dangling layers from the build only

say "updated: vscode-nlp $HAVE_VSCODE_NLP -> $WANT_VSCODE_NLP, engine $HAVE_NLP_ENGINE -> $WANT_NLP_ENGINE"
say "rollback if needed: docker tag $IMAGE_PREV $IMAGE_LIVE && cd $STOPGAP && docker compose up -d"
say "=== done ==="
