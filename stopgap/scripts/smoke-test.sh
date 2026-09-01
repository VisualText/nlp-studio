#!/usr/bin/env bash
#
# Prove a candidate image works before it is allowed near the live site.
#
# This is the only thing standing between an upstream release with a bad asset
# and studio.visualtext.org serving a broken editor, so it checks the things
# that have actually gone wrong: a partial engine unzip, an nlp.exe built for
# the wrong Ubuntu (glibc/ICU mismatch -- installs fine, dies on first run), the
# /home/examples symlink dangling because the extension version in the path
# changed, an empty seeded workspace, and a server that installs but never
# listens.
#
# Usage:  smoke-test.sh <image> [port]
#
set -euo pipefail

IMAGE="${1:?usage: smoke-test.sh <image> [port]}"
PORT="${2:-3999}"
NAME="nlp-studio-smoke-$$"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "smoke-test: FAIL -- $*" >&2; exit 1; }

echo "smoke-test: image=$IMAGE port=$PORT"

# --- static checks -------------------------------------------------------------
# No server needed; run as the same unprivileged user the container runs as, so
# a permissions regression on the engine directory shows up here rather than as
# a runtime error the first time someone runs an analyzer.
docker run --rm --entrypoint /bin/bash --user openvscode-server "$IMAGE" -c '
set -euo pipefail
ext_dir=/home/nlpstudio/.vscode/extensions
ext="$(find "$ext_dir" -maxdepth 1 -type d -name "dehilster.nlp-*" | sort -V | tail -n 1)"
[ -n "$ext" ] || { echo "no dehilster.nlp-* under $ext_dir"; exit 1; }
echo "  extension: $(basename "$ext")"

engine="$ext/nlp-engine"
for p in nlp.exe data/rfb include lib visualText/spec visualText/Help \
         visualText/analyzer-templates analyzers; do
    [ -e "$engine/$p" ] || { echo "missing $p"; exit 1; }
done
echo "  engine layout: ok"

# The binary has to actually run. A wrong-Ubuntu build unzips perfectly and then
# fails here with a loader error.
#
# Judged on output, not exit status: "nlp.exe --version" prints its version and
# then exits 1, since it was not given an analyzer to run. So the test is that
# it printed something version-shaped -- a loader failure prints a message about
# a missing library and no digits at all.
# Every step below is guarded with || true: the script runs under set -e and
# pipefail, and the non-zero exit is expected here, not a failure.
[ -x "$engine/nlp.exe" ] || { echo "nlp.exe not executable"; exit 1; }
raw="$("$engine/nlp.exe" --version 2>&1 || true)"
ver="$(printf "%s" "$raw" | tr -d "\r" | grep -Eo "[0-9]+\.[0-9]+\.[0-9]+" | tail -n 1 || true)"
[ -n "$ver" ] || {
    echo "nlp.exe did not report a version -- likely a glibc/ICU mismatch. It said:"
    printf "%s\n" "$raw" | tail -n 5
    exit 1
}
echo "  nlp.exe: $ver"

# The stable alias the extension'"'"'s "Load Example Analyzers" cog opens. It
# embeds the extension version in its target, so it breaks on upgrade if the
# Dockerfile'"'"'s symlink step ever stops resolving.
[ -d /home/examples/nlp-tutorials ] || { echo "/home/examples/nlp-tutorials missing or dangling"; exit 1; }
echo "  /home/examples: $(find -L /home/examples -maxdepth 1 -mindepth 1 -type d | wc -l) collections"

# The engine directory is written at runtime (logs, state, tmp, analyzer output).
[ -w "$engine" ] || { echo "engine directory not writable by openvscode-server"; exit 1; }

# Seeded analyzers. Only counts real ones -- a directory without spec/ is not an
# analyzer as far as the extension'"'"'s scan is concerned.
n=0
for d in /home/workspace/*/; do [ -d "$d/spec" ] && n=$((n+1)); done
[ "$n" -gt 0 ] || { echo "no seeded analyzers in /home/workspace"; exit 1; }
echo "  workspace: $n analyzers"
' || fail "static checks"

# --- runtime check -------------------------------------------------------------
# Host networking, matching the live compose service: this host runs CSF, whose
# rules drop forwarded traffic to the docker0 bridge on high ports, so a normal
# published port would connect at docker-proxy and then reset. Bound to loopback
# on a port the live container is not using.
if ss -ltn 2>/dev/null | grep -q "127.0.0.1:$PORT "; then
    fail "port $PORT is already in use"
fi

docker run -d --name "$NAME" --network host --init "$IMAGE" \
    --extensions-dir /home/nlpstudio/.vscode/extensions \
    --host 127.0.0.1 --port "$PORT" >/dev/null || fail "container would not start"

for i in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT/" || true)"
    [ "$code" = 200 ] && break
    if ! docker ps -q --filter "name=$NAME" | grep -q .; then
        docker logs "$NAME" 2>&1 | tail -n 30 >&2
        fail "container exited during startup"
    fi
    sleep 2
done
[ "${code:-}" = 200 ] || {
    docker logs "$NAME" 2>&1 | tail -n 30 >&2
    fail "server never returned 200 on port $PORT (last: ${code:-none})"
}
echo "  http: 200 after ~$((i * 2))s"

# The editor page, not just any 200 -- a proxy error page would also be a 200.
curl -s --max-time 10 "http://127.0.0.1:$PORT/" | grep -qi 'vscode\|openvscode' \
    || fail "response on port $PORT does not look like the editor"
echo "  editor page: ok"

echo "smoke-test: PASS"
