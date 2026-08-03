#!/usr/bin/env bash
# Idempotent deploy of aflow-lite to a VPS over SSH. The remote host must have
# Docker + Compose v2 installed and the calling user must be in the docker group.
#
#   lite/deploy/deploy_vps.sh user@host [/opt/aflow-lite]
#
# It syncs the lite/ tree, optionally uploads lite/deploy/.env, then builds and
# starts the stack remotely. Model credentials come from the *remote* user's
# ~/.qwen (mounted by compose); make sure that file exists on the VPS first.
set -euo pipefail

TARGET="${1:?usage: deploy_vps.sh user@host [remote_dir]}"
REMOTE_DIR="${2:-/opt/aflow-lite}"
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
  rsync -az --chmod=0600 "$HERE/.env" "$TARGET:$REMOTE_DIR/lite/deploy/.env"
fi

# qwen model credentials: upload a local settings.json (never committed) to the
# remote ~/.qwen so the qwen container can authenticate. Provide it via
# QWEN_SETTINGS_FILE or by placing lite/deploy/qwen-settings.json (git-ignored).
QWEN_SETTINGS="${QWEN_SETTINGS_FILE:-$HERE/qwen-settings.json}"
if [ -f "$QWEN_SETTINGS" ]; then
  echo "==> upload qwen settings (model creds) -> remote ~/.qwen/settings.json"
  ssh "$TARGET" "mkdir -p ~/.qwen"
  rsync -az --chmod=0600 "$QWEN_SETTINGS" "$TARGET:~/.qwen/settings.json"
else
  echo "!! no qwen-settings.json found; the qwen container will have no model creds."
  echo "   place one at lite/deploy/qwen-settings.json or set QWEN_SETTINGS_FILE."
fi

echo "==> build & start on remote"
ssh "$TARGET" "cd '${REMOTE_DIR}' && docker compose -f lite/deploy/docker-compose.yml up -d --build"

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
