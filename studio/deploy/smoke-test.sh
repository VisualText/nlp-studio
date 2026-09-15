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

echo "smoke-test: PASS"
