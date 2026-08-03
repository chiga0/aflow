#!/usr/bin/env bash
# Bare-metal (no Docker) deploy of aflow-lite. Ideal for hosts where pulling
# Docker Hub base images is unreliable (e.g. mainland-China VPS) — the runtime
# is stdlib-only Python + a static web bundle, so containers are optional.
#
#   lite/deploy/deploy_baremetal.sh user@host [/opt/aflow-lite]
#
# Remote prerequisites: python3 (3.8+), node (18+), outbound npm access.
# It installs qwen via npm if missing, builds the web bundle on the host, and
# runs `qwen serve` + `python -m lite.runtime` as background processes.
set -euo pipefail

TARGET="${1:?usage: deploy_baremetal.sh user@host [remote_dir]}"
REMOTE_DIR="${2:-/opt/aflow-lite}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LITE_DIR="$(cd "$HERE/.." && pwd)"
QWEN_VERSION="${QWEN_VERSION:-0.21.1}"
AFLOW_PORT="${AFLOW_PORT:-8765}"

echo "==> sync lite/ -> ${TARGET}:${REMOTE_DIR}/lite/"
ssh "$TARGET" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  --exclude node_modules --exclude data \
  --exclude '*.db' --exclude '*.db-*' --exclude BOOTSTRAP_PASSWORD.txt --exclude .git \
  --exclude qwen-settings.json --exclude .env \
  "$LITE_DIR/" "$TARGET:$REMOTE_DIR/lite/"

if [ -f "$HERE/.env" ]; then
  echo "==> upload .env"
  rsync -az --chmod=0600 "$HERE/.env" "$TARGET:$REMOTE_DIR/lite/deploy/.env"
fi

QWEN_SETTINGS="${QWEN_SETTINGS_FILE:-$HERE/qwen-settings.json}"
if [ -f "$QWEN_SETTINGS" ]; then
  echo "==> upload qwen settings -> remote ~/.qwen/settings.json"
  ssh "$TARGET" "mkdir -p ~/.qwen"
  rsync -az --chmod=0600 "$QWEN_SETTINGS" "$TARGET:~/.qwen/settings.json"
else
  echo "!! no qwen-settings.json; qwen will have no model creds."
fi

echo "==> setup + start on remote (no docker)"
ssh "$TARGET" "REMOTE_DIR='${REMOTE_DIR}' QWEN_VERSION='${QWEN_VERSION}' AFLOW_PORT='${AFLOW_PORT}' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

command -v python3 >/dev/null || { echo "ERROR: python3 not found on remote"; exit 1; }
command -v node    >/dev/null || { echo "ERROR: node not found on remote"; exit 1; }

# optional npm mirror for mainland hosts (uncomment if npmjs is slow/blocked):
# npm config set registry https://registry.npmmirror.com

# build web bundle if not present
if [ ! -f lite/web/dist/index.html ]; then
  echo "-- building web (npm install + vite build) --"
  ( cd lite/web && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund && npm run build )
fi

# install qwen CLI if missing
if ! command -v qwen >/dev/null; then
  echo "-- installing qwen ${QWEN_VERSION} --"
  npm install -g "@qwen-code/qwen-code@${QWEN_VERSION}"
fi

# load .env (auth + tokens) if present
if [ -f lite/deploy/.env ]; then set -a; . lite/deploy/.env; set +a; fi
export QWEN_SERVE_TOKEN="${QWEN_SERVE_TOKEN:-aflow-internal-token-change-me}"
export QWEN_SERVE_URL="http://127.0.0.1:4170"
export AFLOW_STATIC_DIR="$REMOTE_DIR/lite/web/dist"

# start qwen serve (loopback, so no token required by qwen itself)
if ! curl -fsS http://127.0.0.1:4170/health >/dev/null 2>&1; then
  echo "-- starting qwen serve --"
  nohup qwen serve --hostname 127.0.0.1 --port 4170 > /tmp/qwen-serve.log 2>&1 &
  for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4170/health >/dev/null 2>&1 && break; sleep 1; done
fi

# (re)start runtime
pkill -f "lite.runtime" 2>/dev/null || true
sleep 1
echo "-- starting aflow-lite runtime on :${AFLOW_PORT} --"
nohup python3 -m lite.runtime --host 0.0.0.0 --port "${AFLOW_PORT}" > /tmp/aflow-lite.log 2>&1 &
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
