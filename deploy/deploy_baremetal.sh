#!/usr/bin/env bash
# Bare-metal (no Docker) deploy of aflow. Ideal for hosts where pulling Docker
# Hub base images is unreliable (e.g. mainland-China VPS) — the runtime is
# stdlib-only Python + a static web bundle, so containers are optional.
#
#   deploy/deploy_baremetal.sh user@host [/opt/aflow]
#
# Remote prerequisites: python3 (3.8+), node (18+), outbound npm access.
# Engine: AFLOW_ENGINE=pi (default) installs pi and runs agent sessions as
# short-lived RPC subprocesses; AFLOW_ENGINE=qwen keeps the qwen serve daemon.

set -euo pipefail

TARGET="${1:?usage: deploy_baremetal.sh user@host [remote_dir]}"
REMOTE_DIR="${2:-/opt/aflow}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$HERE/.." && pwd)"
QWEN_VERSION="${QWEN_VERSION:-0.21.1}"
PI_VERSION="${PI_VERSION:-0.83.0}"
AFLOW_PORT="${AFLOW_PORT:-8765}"
ENGINE="${AFLOW_ENGINE:-pi}"

echo "==> sync -> ${TARGET}:${REMOTE_DIR}/"
ssh "$TARGET" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  --exclude node_modules --exclude data \
  --exclude '*.db' --exclude '*.db-*' --exclude BOOTSTRAP_PASSWORD.txt --exclude .git \
  --exclude qwen-settings.json --exclude .env --exclude screenshots \
  "$ROOT_DIR/" "$TARGET:$REMOTE_DIR/"

# migrate: previous layout kept everything under <remote>/lite/
ssh "$TARGET" "rm -rf '${REMOTE_DIR}/lite'"

if [ -f "$HERE/.env" ]; then
  echo "==> upload .env"
  rsync -az "$HERE/.env" "$TARGET:$REMOTE_DIR/deploy/.env"
  ssh "$TARGET" "chmod 600 '$REMOTE_DIR/deploy/.env'"
fi

QWEN_SETTINGS="${QWEN_SETTINGS_FILE:-$HERE/qwen-settings.json}"
if [ -f "$QWEN_SETTINGS" ]; then
  echo "==> upload qwen settings -> remote ~/.qwen/settings.json"
  ssh "$TARGET" "mkdir -p ~/.qwen"
  rsync -az "$QWEN_SETTINGS" "$TARGET:~/.qwen/settings.json"
  ssh "$TARGET" "chmod 600 ~/.qwen/settings.json"
else
  echo "!! no qwen-settings.json; qwen will have no model creds."
fi

# Ensure the pi model key lands in the remote .env (deduped). Source order:
# PI_ENGINE_API_KEY env (CI secrets) -> local qwen settings template.
PI_KEY="${PI_ENGINE_API_KEY:-}"
if [ -z "$PI_KEY" ] && [ -f "$QWEN_SETTINGS" ]; then
  PI_KEY="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('env',{}).get('BAILIAN_TOKEN_PLAN_API_KEY',''))" "$QWEN_SETTINGS" 2>/dev/null || true)"
fi
if [ -n "$PI_KEY" ]; then
  ssh "$TARGET" "touch '${REMOTE_DIR}/deploy/.env' && sed -i '/^PI_ENGINE_API_KEY=/d' '${REMOTE_DIR}/deploy/.env'"
  printf '\nPI_ENGINE_API_KEY="%s"\n' "$PI_KEY" | ssh "$TARGET" \
    "cat >> '${REMOTE_DIR}/deploy/.env' && chmod 600 '${REMOTE_DIR}/deploy/.env'"
else
  echo "!! qwen-settings.json has no env.BAILIAN_TOKEN_PLAN_API_KEY; pi will lack a model key"
fi

echo "==> setup + start on remote (no docker, engine: ${ENGINE})"
ssh "$TARGET" "REMOTE_DIR='${REMOTE_DIR}' QWEN_VERSION='${QWEN_VERSION}' PI_VERSION='${PI_VERSION}' AFLOW_PORT='${AFLOW_PORT}' ENGINE='${ENGINE}' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

command -v python3 >/dev/null || { echo "ERROR: python3 not found on remote"; exit 1; }
command -v node    >/dev/null || { echo "ERROR: node not found on remote"; exit 1; }

# optional npm mirror for mainland hosts (uncomment if npmjs is slow/blocked):
# npm config set registry https://registry.npmmirror.com

# install engine CLI if missing
if [ "$ENGINE" = qwen ] && ! command -v qwen >/dev/null; then
  echo "-- installing qwen ${QWEN_VERSION} --"
  npm install -g "@qwen-code/qwen-code@${QWEN_VERSION}"
fi
if [ "$ENGINE" = pi ] && ! command -v pi >/dev/null; then
  echo "-- installing pi ${PI_VERSION} --"
  npm install -g "@earendil-works/pi-coding-agent@${PI_VERSION}"
fi

# load .env (auth + tokens) if present
if [ -f deploy/.env ]; then set -a; . deploy/.env; set +a; fi
export AFLOW_STATIC_DIR="$REMOTE_DIR/web/dist"

if [ "$ENGINE" = pi ]; then
  # pi engine: short-lived RPC subprocesses, no resident daemon.
  export AFLOW_ENGINE=pi
  export PI_ENGINE_CWD="${PI_ENGINE_CWD:-$REMOTE_DIR/workspace}"
  mkdir -p "$PI_ENGINE_CWD"
  # model key: fall back to the key already present in ~/.qwen settings.
  if [ -z "${PI_ENGINE_API_KEY:-}" ]; then
    export PI_ENGINE_API_KEY="$(python3 - <<'PY'
import json, os
print(json.load(open(os.path.expanduser("~/.qwen/settings.json")))["env"]["BAILIAN_TOKEN_PLAN_API_KEY"])
PY
)"
  fi
  # free the ~250MB the qwen daemon was holding.
  pkill -f "qwen serve" 2>/dev/null || true
  pkill -f "@qwen-code/qwen-code" 2>/dev/null || true
else
  export QWEN_SERVE_TOKEN="${QWEN_SERVE_TOKEN:-aflow-internal-token-change-me}"
  export QWEN_SERVE_URL="http://127.0.0.1:4170"
  # start qwen serve (loopback, so no token required by qwen itself)
  if ! curl -fsS http://127.0.0.1:4170/health >/dev/null 2>&1; then
    echo "-- starting qwen serve --"
    nohup qwen serve --hostname 127.0.0.1 --port 4170 > /tmp/qwen-serve.log 2>&1 &
    for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4170/health >/dev/null 2>&1 && break; sleep 1; done
  fi
fi

# build web bundle when missing or stale (src newer than dist); rsync usually
# ships a fresh dist from the dev machine, so this is the fallback path.
if [ ! -d web/node_modules ]; then
  ( cd web && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund )
fi
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html -newer web/dist/index.html 2>/dev/null | head -1)" ]; then
  echo "-- building web --"
  ( cd web && NODE_OPTIONS=--max-old-space-size=1024 npm run build )
else
  echo "-- web bundle up to date --"
fi

# (re)start runtime
pkill -f "python3 -m runtime" 2>/dev/null || true
pkill -f "python3 -m lite.runtime" 2>/dev/null || true
sleep 1
echo "-- starting aflow runtime on :${AFLOW_PORT} --"
nohup python3 -m runtime --host 0.0.0.0 --port "${AFLOW_PORT}" > /tmp/aflow-lite.log 2>&1 &
REMOTE

echo "==> wait for health"
ssh "$TARGET" "for i in \$(seq 1 30); do
  if curl -fsS http://127.0.0.1:${AFLOW_PORT}/api/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:${AFLOW_PORT}/api/health; echo; exit 0
  fi
  sleep 2
done; echo 'runtime did not become healthy; tail /tmp/aflow-lite.log'; exit 1"

echo
echo "Deployed (bare-metal). Open http://<host>:${AFLOW_PORT}"
