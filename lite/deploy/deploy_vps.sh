#!/usr/bin/env bash
# Idempotent deploy of aflow-lite to a VPS over SSH. The remote host must have
# Docker + Compose v2 installed and the calling user must be in the docker group.
#
#   lite/deploy/deploy_vps.sh user@host [/opt/aflow-lite]
#
# Engine selection: AFLOW_ENGINE=pi (default) uses the lightweight pi RPC
# engine baked into the runtime image; AFLOW_ENGINE=qwen keeps the qwen serve
# daemon. For qwen, model credentials come from the remote ~/.qwen (mounted by
# compose); for pi, the key is injected as PI_ENGINE_API_KEY into the remote
# .env (extracted from the local qwen settings file).
set -euo pipefail

TARGET="${1:?usage: deploy_vps.sh user@host [remote_dir]}"
REMOTE_DIR="${2:-/opt/aflow-lite}"
ENGINE="${AFLOW_ENGINE:-pi}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LITE_DIR="$(cd "$HERE/.." && pwd)"

echo "==> sync lite/ -> ${TARGET}:${REMOTE_DIR}/lite/"
ssh "$TARGET" "mkdir -p '${REMOTE_DIR}'"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude data \
  --exclude '*.db' --exclude '*.db-*' --exclude BOOTSTRAP_PASSWORD.txt --exclude .git \
  "$LITE_DIR/" "$TARGET:$REMOTE_DIR/lite/"

if [ -f "$HERE/.env" ]; then
  echo "==> upload .env"
  rsync -az "$HERE/.env" "$TARGET:$REMOTE_DIR/lite/deploy/.env"
  ssh "$TARGET" "chmod 600 '$REMOTE_DIR/lite/deploy/.env'"
fi

# qwen model credentials: upload a local settings.json (never committed) to the
# remote ~/.qwen so the qwen container can authenticate. Provide it via
# QWEN_SETTINGS_FILE or by placing lite/deploy/qwen-settings.json (git-ignored).
QWEN_SETTINGS="${QWEN_SETTINGS_FILE:-$HERE/qwen-settings.json}"
if [ -f "$QWEN_SETTINGS" ]; then
  echo "==> upload qwen settings (model creds) -> remote ~/.qwen/settings.json"
  ssh "$TARGET" "mkdir -p ~/.qwen"
  rsync -az "$QWEN_SETTINGS" "$TARGET:~/.qwen/settings.json"
  ssh "$TARGET" "chmod 600 ~/.qwen/settings.json"
else
  echo "!! no qwen-settings.json found; the qwen container will have no model creds."
  echo "   place one at lite/deploy/qwen-settings.json or set QWEN_SETTINGS_FILE."
fi

echo "==> build & start on remote (engine: ${ENGINE})"
if [ "$ENGINE" = "pi" ]; then
  COMPOSE_FILE="lite/deploy/docker-compose.pi.yml"
  # Inject the model key for pi, extracted from the remote ~/.qwen settings
  # (the VPS already holds a valid key there).
  echo "==> inject PI_ENGINE_API_KEY into remote .env (from remote ~/.qwen)"
  ssh "$TARGET" REMOTE_DIR="$REMOTE_DIR" bash -s <<'EOS'
set -e
KEY=$(python3 - <<'PY'
import json, os
print(json.load(open(os.path.expanduser("~/.qwen/settings.json")))["env"]["BAILIAN_TOKEN_PLAN_API_KEY"])
PY
)
ENVF="${REMOTE_DIR}/lite/deploy/.env"
touch "$ENVF"
sed -i '/^PI_ENGINE_API_KEY=/d' "$ENVF"
printf '\nPI_ENGINE_API_KEY="%s"\n' "$KEY" >> "$ENVF"
chmod 600 "$ENVF"
EOS
else
  COMPOSE_FILE="lite/deploy/docker-compose.yml"
fi
ssh "$TARGET" "cd '${REMOTE_DIR}' && AFLOW_ENGINE='${ENGINE}' docker compose -f '${COMPOSE_FILE}' up -d --build"

echo "==> wait for health"
ssh "$TARGET" 'for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8765/api/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8765/api/health; echo; break
  fi
  sleep 2
done' || true

echo
echo "Deployed. Open http://<host>:8765"
echo "For HTTPS: set AFLOW_DOMAIN and re-run with the https overlay (see README)."
