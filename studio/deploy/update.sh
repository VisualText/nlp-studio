#!/usr/bin/env bash
#
# Keep the NLP Studio app (studio.visualtext.org/studio/) current.
#
# The image is built from this checkout's studio/ and analyzer-views/, plus the analyzer templates of
# the latest visualtext-files and analyzers releases, and is rebuilt when any moves: a new
# commit here (after a deliberate git pull on the server) or a new release. Same
# shape as stopgap/scripts/update-studio.sh: build a candidate, smoke-test it away
# from the live container, only then swap, and roll back if it does not answer.
#
# Usage:
#   update.sh              update if anything moved
#   update.sh --check      report drift and exit; never builds
#   update.sh --force      rebuild and swap even if nothing moved
#   update.sh --no-swap    build and test a candidate, leave the live app alone
#
# Exit status:  0 nothing to do, or updated successfully
#               1 something went wrong (the live app left on its working image)
#               2 --check only: an update is available
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO="$(dirname "$here")"
REPO="$(dirname "$STUDIO")"
COMPOSE=(docker compose -f "$here/docker-compose.yml")

IMAGE_LIVE="nlp-studio:app"
IMAGE_PREV="nlp-studio:app-previous"
IMAGE_NEW="nlp-studio:app-candidate"
SERVICE="nlp-studio-app"
HEALTH_URL="http://127.0.0.1:3002/api/health"
LOG_DIR="${NLP_STUDIO_LOG_DIR:-$REPO/stopgap/logs}"
LOG_KEEP_DAYS=30

MODE=update
for arg in "$@"; do
    case "$arg" in
        --check)   MODE=check  ;;
        --force)   MODE=force  ;;
        --no-swap) MODE=noswap ;;
        -h|--help) sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "update: unknown option $arg (try --help)" >&2; exit 1 ;;
    esac
done

# --- logging -------------------------------------------------------------------
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/update-app-$(date +%Y-%m).log"
exec > >(tee -a "$LOG_FILE") 2>&1
find "$LOG_DIR" -maxdepth 1 -name 'update-app-*.log' -mtime "+$LOG_KEEP_DAYS" -delete 2>/dev/null || true

say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
die() { say "ERROR: $*"; exit 1; }

# --- one at a time -------------------------------------------------------------
exec 9>"$here/.update.lock"
if ! flock -n 9; then
    say "another app update is already running; nothing to do"
    exit 0
fi

say "=== update app ($MODE) ==="

# --- what we want --------------------------------------------------------------
auth=()
[ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")

WANT_VT_FILES="$(curl -fsSL --retry 3 --retry-delay 2 "${auth[@]}" \
        -H 'Accept: application/vnd.github+json' \
        https://api.github.com/repos/VisualText/visualtext-files/releases/latest \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')" \
    || die "cannot reach GitHub (visualtext-files)"

WANT_ANALYZERS="$(curl -fsSL --retry 3 --retry-delay 2 "${auth[@]}" \
        -H 'Accept: application/vnd.github+json' \
        https://api.github.com/repos/VisualText/analyzers/releases/latest \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')" \
    || die "cannot reach GitHub (analyzers)"

WANT_COMMIT="$(git -C "$REPO" rev-parse --short=12 HEAD)" || die "$REPO is not a git checkout"
# Edits on the server that were never committed are labelled as such, so --check
# and the image labels do not claim a commit the image does not match.
if [ -n "$(git -C "$REPO" status --porcelain -- studio analyzer-views)" ]; then
    WANT_COMMIT="$WANT_COMMIT-dirty"
fi

# --- what we are running -------------------------------------------------------
label() { docker image inspect "$1" --format "{{index .Config.Labels \"$2\"}}" 2>/dev/null || true; }

if docker image inspect "$IMAGE_LIVE" >/dev/null 2>&1; then
    HAVE_COMMIT="$(label "$IMAGE_LIVE" org.visualtext.nlp-studio)"
    HAVE_VT_FILES="$(label "$IMAGE_LIVE" org.visualtext.visualtext-files)"
    HAVE_ANALYZERS="$(label "$IMAGE_LIVE" org.visualtext.analyzers)"
else
    say "no $IMAGE_LIVE image yet -- treating everything as out of date"
fi
: "${HAVE_COMMIT:=none}" "${HAVE_VT_FILES:=none}" "${HAVE_ANALYZERS:=none}"

drift=0
report() {   # report <name> <have> <want>
    if [ "$2" = "$3" ]; then
        printf '  %-18s %-18s current\n' "$1" "$2"
    else
        printf '  %-18s %-18s -> %s\n' "$1" "$2" "$3"
        drift=1
    fi
}
report nlp-studio       "$HAVE_COMMIT"   "$WANT_COMMIT"
report visualtext-files "$HAVE_VT_FILES" "$WANT_VT_FILES"
report analyzers        "$HAVE_ANALYZERS" "$WANT_ANALYZERS"

if [ "$MODE" = check ]; then
    [ "$drift" -eq 0 ] && { say "up to date"; exit 0; }
    say "an update is available"
    exit 2
fi

if [ "$drift" -eq 0 ] && [ "$MODE" != force ]; then
    say "up to date; nothing to do"
    exit 0
fi

# --- build and test ------------------------------------------------------------
say "building $IMAGE_NEW"
# --pull so security fixes in the node and python base images are picked up.
docker build \
    --pull \
    --build-arg "NLP_STUDIO_COMMIT=$WANT_COMMIT" \
    --build-arg "VISUALTEXT_FILES_TAG=$WANT_VT_FILES" \
    --build-arg "VISUALTEXT_ANALYZERS_TAG=$WANT_ANALYZERS" \
    --build-arg "BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    -t "$IMAGE_NEW" \
    -f "$STUDIO/Dockerfile" \
    "$REPO" \
    || die "build failed -- live app untouched, still on $HAVE_COMMIT"

say "smoke-testing $IMAGE_NEW"
"$here/smoke-test.sh" "$IMAGE_NEW" \
    || die "candidate failed its smoke test -- live app untouched, still on $HAVE_COMMIT"

if [ "$MODE" = noswap ]; then
    say "candidate built and passed; leaving it as $IMAGE_NEW (--no-swap)"
    say "swap it in with: docker tag $IMAGE_NEW $IMAGE_LIVE && ${COMPOSE[*]} up -d $SERVICE"
    exit 0
fi

# --- swap ----------------------------------------------------------------------
had_previous=0
if docker image inspect "$IMAGE_LIVE" >/dev/null 2>&1; then
    docker tag "$IMAGE_LIVE" "$IMAGE_PREV"
    had_previous=1
fi
docker tag "$IMAGE_NEW" "$IMAGE_LIVE"

say "restarting $SERVICE"
"${COMPOSE[@]}" up -d "$SERVICE" || {
    say "compose up failed"
    if [ "$had_previous" -eq 1 ]; then
        docker tag "$IMAGE_PREV" "$IMAGE_LIVE"
        "${COMPOSE[@]}" up -d "$SERVICE" || true
    fi
    die "rolled back to the previous image"
}

# --- health check, and roll back if it is not serving ---------------------------
say "waiting for the app to answer"
ok=0
code=""
for i in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
    [ "$code" = 200 ] && { ok=1; break; }
    sleep 2
done

if [ "$ok" -ne 1 ]; then
    say "the new image is not answering on $HEALTH_URL (last: ${code:-none})"
    "${COMPOSE[@]}" logs --tail 40 "$SERVICE" || true
    if [ "$had_previous" -eq 1 ]; then
        say "rolling back to the previous image"
        docker tag "$IMAGE_PREV" "$IMAGE_LIVE"
        "${COMPOSE[@]}" up -d "$SERVICE" || true
        die "rolled back; the app should be back on $HAVE_COMMIT"
    fi
    die "no previous image to roll back to -- /studio/ is DOWN, investigate now"
fi
say "app is up (200 after ~$((i * 2))s)"

# --- tidy ----------------------------------------------------------------------
docker image rm "$IMAGE_NEW" >/dev/null 2>&1 || true   # the tag; :app holds the image
docker image prune -f >/dev/null 2>&1 || true

say "updated: nlp-studio $HAVE_COMMIT -> $WANT_COMMIT, visualtext-files $HAVE_VT_FILES -> $WANT_VT_FILES, analyzers $HAVE_ANALYZERS -> $WANT_ANALYZERS"
say "rollback if needed: docker tag $IMAGE_PREV $IMAGE_LIVE && ${COMPOSE[*]} up -d $SERVICE"
say "=== done ==="
