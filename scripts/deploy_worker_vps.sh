#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <ssh-target> <ssh-key>" >&2
  exit 2
fi

SSH_TARGET="$1"
SSH_KEY="$2"
APP_DIR="${APP_DIR:-/opt/agentflow}"
STATE_DIR="${STATE_DIR:-/var/lib/cloud-agents-worker}"
V2_WORKSPACE_ROOTS="${V2_WORKSPACE_ROOTS:-$STATE_DIR}"
V2_ENABLE_REAL_CLI_ADAPTERS="${V2_ENABLE_REAL_CLI_ADAPTERS:-1}"
V2_QWEN_CODE_COMMAND="${V2_QWEN_CODE_COMMAND:-qwen -y}"
V2_CODEX_CLI_COMMAND="${V2_CODEX_CLI_COMMAND:-codex exec --skip-git-repo-check -}"
V2_AGENT_TIMEOUT_SECONDS="${V2_AGENT_TIMEOUT_SECONDS:-3600}"
REPO_URL="${REPO_URL:-https://github.com/chiga0/aflow.git}"
NODE_PACKAGE="${NODE_PACKAGE:-@qwen-code/qwen-code@0.19.3}"
CODEX_NODE_PACKAGE="${CODEX_NODE_PACKAGE:-@openai/codex@0.144.5}"
QWEN_SETTINGS_FILE="${QWEN_SETTINGS_FILE:-}"
SOURCE_BUNDLE_FILE="${SOURCE_BUNDLE_FILE:-}"
SOURCE_BUNDLE_REF="${SOURCE_BUNDLE_REF:-main}"
RUN_WORKER_CONTROL_URL="${RUN_WORKER_CONTROL_URL:-}"
RUN_WORKER_TOKEN="${RUN_WORKER_TOKEN:-}"
RUN_WORKER_ID="${RUN_WORKER_ID:-}"
RUN_WORKER_CAPACITY="${RUN_WORKER_CAPACITY:-1}"
RUN_WORKER_LEASE_TTL_SECONDS="${RUN_WORKER_LEASE_TTL_SECONDS:-60}"
RUN_WORKER_POLL_INTERVAL_SECONDS="${RUN_WORKER_POLL_INTERVAL_SECONDS:-2}"
RUN_WORKER_HEARTBEAT_INTERVAL_SECONDS="${RUN_WORKER_HEARTBEAT_INTERVAL_SECONDS:-10}"
RUN_WORKER_RUN_WAIT_TIMEOUT_SECONDS="${RUN_WORKER_RUN_WAIT_TIMEOUT_SECONDS:-300}"
RUN_WORKER_METADATA_JSON="${RUN_WORKER_METADATA_JSON:-}"
if [[ -z "$RUN_WORKER_METADATA_JSON" ]]; then
  RUN_WORKER_METADATA_JSON="{}"
fi
QWEN_SERVE_URL="${QWEN_SERVE_URL:-}"
QWEN_SERVE_TOKEN="${QWEN_SERVE_TOKEN:-}"
DEPLOY_SSH_CONNECT_TIMEOUT_SECONDS="${DEPLOY_SSH_CONNECT_TIMEOUT_SECONDS:-30}"
DEPLOY_COMMAND_TIMEOUT_SECONDS="${DEPLOY_COMMAND_TIMEOUT_SECONDS:-900}"

if [[ -z "$RUN_WORKER_CONTROL_URL" ]]; then
  echo "RUN_WORKER_CONTROL_URL is required" >&2
  exit 2
fi
if [[ -z "$RUN_WORKER_TOKEN" ]]; then
  echo "RUN_WORKER_TOKEN is required" >&2
  exit 2
fi

shell_quote() {
  printf "%q" "$1"
}

REMOTE_ENV=(
  "APP_DIR=$(shell_quote "$APP_DIR")"
  "STATE_DIR=$(shell_quote "$STATE_DIR")"
  "V2_WORKSPACE_ROOTS=$(shell_quote "$V2_WORKSPACE_ROOTS")"
  "V2_ENABLE_REAL_CLI_ADAPTERS=$(shell_quote "$V2_ENABLE_REAL_CLI_ADAPTERS")"
  "V2_QWEN_CODE_COMMAND=$(shell_quote "$V2_QWEN_CODE_COMMAND")"
  "V2_CODEX_CLI_COMMAND=$(shell_quote "$V2_CODEX_CLI_COMMAND")"
  "V2_AGENT_TIMEOUT_SECONDS=$(shell_quote "$V2_AGENT_TIMEOUT_SECONDS")"
  "REPO_URL=$(shell_quote "$REPO_URL")"
  "NODE_PACKAGE=$(shell_quote "$NODE_PACKAGE")"
  "CODEX_NODE_PACKAGE=$(shell_quote "$CODEX_NODE_PACKAGE")"
  "HAS_QWEN_SETTINGS=$(shell_quote "$([[ -n "$QWEN_SETTINGS_FILE" ]] && echo 1 || echo 0)")"
  "HAS_SOURCE_BUNDLE=$(shell_quote "$([[ -n "$SOURCE_BUNDLE_FILE" ]] && echo 1 || echo 0)")"
  "SOURCE_BUNDLE_REF=$(shell_quote "$SOURCE_BUNDLE_REF")"
  "RUN_WORKER_CONTROL_URL=$(shell_quote "$RUN_WORKER_CONTROL_URL")"
  "RUN_WORKER_TOKEN=$(shell_quote "$RUN_WORKER_TOKEN")"
  "RUN_WORKER_ID=$(shell_quote "$RUN_WORKER_ID")"
  "RUN_WORKER_CAPACITY=$(shell_quote "$RUN_WORKER_CAPACITY")"
  "RUN_WORKER_LEASE_TTL_SECONDS=$(shell_quote "$RUN_WORKER_LEASE_TTL_SECONDS")"
  "RUN_WORKER_POLL_INTERVAL_SECONDS=$(shell_quote "$RUN_WORKER_POLL_INTERVAL_SECONDS")"
  "RUN_WORKER_HEARTBEAT_INTERVAL_SECONDS=$(shell_quote "$RUN_WORKER_HEARTBEAT_INTERVAL_SECONDS")"
  "RUN_WORKER_RUN_WAIT_TIMEOUT_SECONDS=$(shell_quote "$RUN_WORKER_RUN_WAIT_TIMEOUT_SECONDS")"
  "RUN_WORKER_METADATA_JSON=$(shell_quote "$RUN_WORKER_METADATA_JSON")"
  "QWEN_SERVE_URL=$(shell_quote "$QWEN_SERVE_URL")"
  "QWEN_SERVE_TOKEN=$(shell_quote "$QWEN_SERVE_TOKEN")"
  "DEPLOY_COMMAND_TIMEOUT_SECONDS=$(shell_quote "$DEPLOY_COMMAND_TIMEOUT_SECONDS")"
)

SSH_OPTIONS=(
  -i "$SSH_KEY"
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout="$DEPLOY_SSH_CONNECT_TIMEOUT_SECONDS"
  -o ConnectionAttempts=1
)

if [[ -n "$QWEN_SETTINGS_FILE" ]]; then
  if [[ ! -f "$QWEN_SETTINGS_FILE" ]]; then
    echo "QWEN_SETTINGS_FILE does not exist: $QWEN_SETTINGS_FILE" >&2
    exit 2
  fi
  scp "${SSH_OPTIONS[@]}" "$QWEN_SETTINGS_FILE" "$SSH_TARGET:/tmp/qwen-settings.json"
fi
if [[ -n "$SOURCE_BUNDLE_FILE" ]]; then
  if [[ ! -f "$SOURCE_BUNDLE_FILE" ]]; then
    echo "SOURCE_BUNDLE_FILE does not exist: $SOURCE_BUNDLE_FILE" >&2
    exit 2
  fi
  scp "${SSH_OPTIONS[@]}" "$SOURCE_BUNDLE_FILE" "$SSH_TARGET:/tmp/agentflow-source.bundle"
fi

ssh "${SSH_OPTIONS[@]}" "$SSH_TARGET" "${REMOTE_ENV[*]} bash -s" <<'REMOTE'
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

log_step() {
  printf '[worker-deploy] %s\n' "$*"
}

run_timeout() {
  local label="$1"
  local timeout_seconds="$2"
  shift 2
  log_step "$label"
  timeout "$timeout_seconds" "$@"
}

run_retry() {
  local label="$1"
  local timeout_seconds="$2"
  shift 2
  local attempt
  for attempt in 1 2 3; do
    log_step "$label (attempt $attempt/3)"
    if timeout "$timeout_seconds" "$@"; then
      return 0
    fi
    if [[ "$attempt" -lt 3 ]]; then
      sleep "$((attempt * 2))"
    fi
  done
  return 1
}

if ! command -v git >/dev/null \
  || ! command -v python3 >/dev/null \
  || ! command -v npm >/dev/null; then
  run_retry \
    "apt-get update" \
    "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
    apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update
  run_timeout \
    "install worker host packages" \
    "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
    apt-get install -y git python3 npm
fi

install_node_package() {
  local package="$1"
  if npm list -g "$package" --depth=0 >/dev/null 2>&1; then
    log_step "node package already installed: $package"
    return
  fi
  run_timeout \
    "install node package $package" \
    "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
    npm install -g "$package"
}

install_node_package "$NODE_PACKAGE"
install_node_package "$CODEX_NODE_PACKAGE"

if ! id cloudagents >/dev/null 2>&1; then
  log_step "create cloudagents user"
  useradd --system --create-home --shell /usr/sbin/nologin cloudagents
fi

mkdir -p "$APP_DIR" "$STATE_DIR/artifacts"
chown -R cloudagents:cloudagents "$STATE_DIR"
install -d -m 700 -o cloudagents -g cloudagents /home/cloudagents/.qwen
if [[ "$HAS_QWEN_SETTINGS" == "1" ]]; then
  install -m 600 -o cloudagents -g cloudagents \
    /tmp/qwen-settings.json \
    /home/cloudagents/.qwen/settings.json
  rm -f /tmp/qwen-settings.json
fi

if [[ "$HAS_SOURCE_BUNDLE" == "1" ]]; then
  if [[ ! -d "$APP_DIR/.git" ]]; then
    run_timeout \
      "clone runtime source bundle" \
      "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
      git clone --branch "$SOURCE_BUNDLE_REF" \
        /tmp/agentflow-source.bundle "$APP_DIR"
    git -C "$APP_DIR" branch -M main
    git -C "$APP_DIR" update-ref refs/remotes/origin/main HEAD
    git -C "$APP_DIR" branch --set-upstream-to=origin/main main
  else
    run_timeout \
      "fetch runtime source bundle" \
      "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
      git -C "$APP_DIR" fetch \
        /tmp/agentflow-source.bundle \
        "$SOURCE_BUNDLE_REF:refs/remotes/origin/main"
  fi
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  git -C "$APP_DIR" reset --hard origin/main
  rm -f /tmp/agentflow-source.bundle
elif [[ ! -d "$APP_DIR/.git" ]]; then
  run_retry \
    "clone runtime repository" \
    "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
    git clone "$REPO_URL" "$APP_DIR"
else
  run_retry \
    "fetch runtime repository" \
    "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
    git -C "$APP_DIR" fetch origin main
  run_timeout \
    "reset runtime repository" \
    "$DEPLOY_COMMAND_TIMEOUT_SECONDS" \
    git -C "$APP_DIR" reset --hard origin/main
fi

if [[ -z "$RUN_WORKER_ID" ]]; then
  RUN_WORKER_ID="$(hostname -f 2>/dev/null || hostname)"
fi

cat > /etc/cloud-agents-worker.env <<EOF
RUN_WORKER_CONTROL_URL=$RUN_WORKER_CONTROL_URL
RUN_WORKER_TOKEN=$RUN_WORKER_TOKEN
RUN_WORKER_ID=$RUN_WORKER_ID
RUN_WORKER_CAPACITY=$RUN_WORKER_CAPACITY
RUN_WORKER_LEASE_TTL_SECONDS=$RUN_WORKER_LEASE_TTL_SECONDS
RUN_WORKER_POLL_INTERVAL_SECONDS=$RUN_WORKER_POLL_INTERVAL_SECONDS
RUN_WORKER_HEARTBEAT_INTERVAL_SECONDS=$RUN_WORKER_HEARTBEAT_INTERVAL_SECONDS
RUN_WORKER_RUN_WAIT_TIMEOUT_SECONDS=$RUN_WORKER_RUN_WAIT_TIMEOUT_SECONDS
RUN_WORKER_ARTIFACT_ROOT=$STATE_DIR/artifacts
RUN_WORKER_METADATA_JSON=$RUN_WORKER_METADATA_JSON
V2_WORKSPACE_ROOTS=$V2_WORKSPACE_ROOTS
V2_ENABLE_REAL_CLI_ADAPTERS=$V2_ENABLE_REAL_CLI_ADAPTERS
V2_QWEN_CODE_COMMAND=$V2_QWEN_CODE_COMMAND
V2_CODEX_CLI_COMMAND=$V2_CODEX_CLI_COMMAND
V2_AGENT_TIMEOUT_SECONDS=$V2_AGENT_TIMEOUT_SECONDS
QWEN_SERVE_URL=$QWEN_SERVE_URL
QWEN_SERVE_TOKEN=$QWEN_SERVE_TOKEN
EOF
chmod 600 /etc/cloud-agents-worker.env

cp "$APP_DIR/deploy/systemd/cloud-agents-worker.service" /etc/systemd/system/
legacy_paths_dropin=/etc/systemd/system/cloud-agents-worker.service.d/paths.conf
if [[ -f "$legacy_paths_dropin" ]] \
  && grep -q '/opt/agentflow-worker' "$legacy_paths_dropin"; then
  log_step "remove legacy worker path override"
  rm -f "$legacy_paths_dropin"
fi
systemctl daemon-reload
systemctl enable --now cloud-agents-worker
systemctl restart cloud-agents-worker
sleep 3
if ! systemctl --no-pager --full status cloud-agents-worker; then
  journalctl -u cloud-agents-worker -n 120 --no-pager || true
  exit 3
fi

echo "worker $RUN_WORKER_ID registered through $RUN_WORKER_CONTROL_URL"
REMOTE
