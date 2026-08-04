#!/usr/bin/env bash
# Runs ON the VPS (via ssh): login, run a real mission, assert it completes with
# agent text. Exit non-zero if the mission fails (e.g. model 403).
#   remote_mission_smoke.sh <email> <password>
set -euo pipefail
EMAIL="${1:-admin@aflow.local}"
PASS="${2:-}"
B=http://127.0.0.1:8765

curl -s -c /tmp/cj -X POST -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$B/api/auth/login" >/dev/null

mid=$(curl -s -b /tmp/cj -X POST -H 'content-type: application/json' \
  -d '{"goal":"只回复六个字：部署验证成功"}' "$B/api/missions" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "mission=$mid"

for k in $(seq 1 40); do
  st=$(curl -s -b /tmp/cj "$B/api/missions/$mid" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["mission"]["status"])')
  [ "$st" != pending ] && [ "$st" != running ] && break
  sleep 2
done

curl -s -b /tmp/cj "$B/api/missions/$mid" | python3 -c 'import sys,json
d=json.load(sys.stdin); s=d["steps"][0]
print("mission_status=", d["mission"]["status"])
print("agent_reply=", (s["result_text"] or "")[:80])
print("step_error=", (s["error"] or "")[:120])
sys.exit(0 if d["mission"]["status"]=="completed" else 1)'
