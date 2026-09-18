#!/usr/bin/env bash
#
# Prove an NLP Studio app image works -- restricted exactly as it runs live --
# before it is allowed near the site.
#
# Usage:  smoke-test.sh <image> [port]
#
# Checks that the server starts under a read-only root with no capabilities; that
# it finds NLPPlus and serves the page and the analyzer list; that the engine runs
# the studio's own sample to its known output; that system() is refused; and that
# a run cannot write outside its temporary folder.
#
set -euo pipefail

IMAGE="${1:?usage: smoke-test.sh <image> [port]}"
PORT="${2:-3998}"
NAME="nlp-studio-app-smoke-$$"
BASE="http://127.0.0.1:$PORT"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
    echo "smoke-test: FAIL -- $*" >&2
    docker logs "$NAME" 2>&1 | tail -n 30 >&2 || true
    exit 1
}

echo "smoke-test: image=$IMAGE port=$PORT"

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q "127.0.0.1:$PORT "; then
    echo "smoke-test: FAIL -- port $PORT is already in use" >&2
    exit 1
fi

# The restrictions of docker-compose.yml, on a port the live container is not using.
docker run -d --name "$NAME" --init --network host \
    --read-only --tmpfs /tmp:size=512m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --cpus 1 --memory 1g --pids-limit 128 \
    "$IMAGE" python server/app.py --host 127.0.0.1 --port "$PORT" --dist dist >/dev/null \
    || fail "container would not start"

code=""
for i in $(seq 1 60); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/health" || true)"
    [ "$code" = 200 ] && break
    docker ps -q --filter "name=$NAME" | grep -q . || fail "container exited during startup"
    sleep 1
done
[ "$code" = 200 ] || fail "no answer from $BASE/api/health (last: ${code:-none})"

health="$(curl -s "$BASE/api/health")"
echo "  health: $health"
echo "$health" | grep -q '"engine": "[0-9]' || fail "the server cannot find NLPPlus"

curl -s "$BASE/" | grep -q '<title>NLP Studio</title>' || fail "/ is not the studio page"
index="$(curl -s "$BASE/analyzers/index.json")"
echo "$index" | grep -q '"hello-studio"' || fail "analyzers/index.json does not list hello-studio"
echo "  page and analyzer list: ok ($(echo "$index" | grep -c '"origin"') analyzers)"

# The try page (try/index.html) and the analyzers baked in for it. They are what the
# page can run, so an image that lost them would serve an empty picker.
curl -s "$BASE/try/" | grep -q '<title>Try an analyzer' || fail "/try/ is not the try page"
try_index="$(curl -s "$BASE/try/analyzers/index.json")"
try_count="$(echo "$try_index" | grep -c '"pinned"')"
[ "$try_count" -gt 0 ] || fail "try/analyzers/index.json lists no analyzers"
echo "$try_index" | grep -qE '"(release|commit)": "[^n]' \
    || fail "the try analyzers say no release or commit they came from"
echo "  try page and its analyzers: ok ($try_count analyzers)"

# The runs, from inside the container as its own user, so the sample's files come
# from the image that is being tested.
docker exec -i "$NAME" python - "$PORT" <<'PY' || fail "runs"
import json, os, pathlib, sys, urllib.request

base = f"http://127.0.0.1:{sys.argv[1]}"
root = pathlib.Path("dist/analyzers/hello-studio")
files = {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8", errors="replace")
         for p in sorted(root.rglob("*")) if p.is_file() and p.relative_to(root).parts[0] in ("spec", "kb")}
text = (root / "input" / "hello.txt").read_text(encoding="utf-8")

def run(changes):
    body = json.dumps({"files": {**files, **changes}, "text": text}).encode("utf-8")
    req = urllib.request.Request(base + "/api/run", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)

r = run({})
got = json.loads(r["output"].get("output.json") or "null")
if r["status"] != "ok" or got != {"greetings": 3}:
    sys.exit(f"the sample did not run to its output: {json.dumps(r)[:600]}")
print(f"  sample run: ok, {got} in {r['ms']} ms")

r = run({"spec/output.nlp": '@CODE\nsystem("id");\n@@CODE\n'})
if r["status"] != "rejected":
    sys.exit(f"system() was not refused: {json.dumps(r)[:400]}")
print("  system() refused: ok")

target = "/app/dist/written-by-a-run.txt"
r = run({"spec/output.nlp": f'@CODE\nL("f") = openfile("{target}");\nL("f") << "x";\nclosefile(L("f"));\n@@CODE\n'})
if os.path.exists(target):
    sys.exit("a run wrote outside its temporary folder")
print(f"  a run cannot write to /app: ok (that run: {r['status']})")
PY

# The try page's own path: one of VisualText's analyzers, run in debug mode, keeps a
# tree after every pass, and each of those trees can be fetched back. That is what puts
# the two icons on a pass, so if this breaks the page loses the feature silently.
docker exec -i "$NAME" python - "$PORT" <<'PY' || fail "try-page run"
import json, pathlib, sys, urllib.parse, urllib.request

base = f"http://127.0.0.1:{sys.argv[1]}"
index = json.load(urllib.request.urlopen(f"{base}/try/analyzers/index.json", timeout=30))["analyzers"]
entry = min(index, key=lambda a: len(a["files"]))          # the quickest one to run
root = pathlib.Path("dist/try/analyzers") / entry["name"]
files = {f: (root / f).read_text(encoding="utf-8", errors="replace") for f in entry["files"]}
text = files.get(entry["input"], "")

body = json.dumps({"files": files, "text": text, "develop": True}).encode("utf-8")
req = urllib.request.Request(base + "/api/run", data=body, headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=120) as res:
    r = json.load(res)
if r["status"] != "ok":
    sys.exit(f"{entry['name']} did not run: {json.dumps(r)[:600]}")

trees = r.get("trees") or {}
per_pass = [t for t in trees.get("files", []) if t["pass"] is not None]
if not per_pass:
    sys.exit(f"a debug run kept no per-pass tree: {json.dumps(trees)[:400]}")

name = per_pass[0]["name"]
query = urllib.parse.urlencode({"run": trees["run"], "name": name})
tree = urllib.request.urlopen(f"{base}/api/run/tree?{query}", timeout=30).read().decode("utf-8", "replace")
if not tree.strip():
    sys.exit(f"{name} came back empty")
print(f"  try run: ok, {entry['name']} in {r['ms']} ms, {len(per_pass)} pass trees, {name} fetched")
PY

echo "smoke-test: PASS"
