#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DATA_DIR="${RUNTIME_DATA_DIR:-/opt/cloud-agents-runtime/data}"
RUNTIME_BACKUP_DIR="${RUNTIME_BACKUP_DIR:-/opt/cloud-agents-runtime/backups}"
RUNTIME_BACKUP_RETENTION="${RUNTIME_BACKUP_RETENTION:-10}"
SERVICE_NAME="${SERVICE_NAME:-cloud-agents-runtime}"

usage() {
  echo "usage: $0 backup" >&2
  echo "       $0 restore <backup-file>" >&2
  exit 2
}

do_backup() {
  if [[ ! -d "$RUNTIME_DATA_DIR" ]]; then
    echo "data directory not found: $RUNTIME_DATA_DIR" >&2
    exit 1
  fi
  mkdir -p "$RUNTIME_BACKUP_DIR"
  local timestamp
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local name="cloud-agents-backup-${timestamp}.tar.gz"
  local path="$RUNTIME_BACKUP_DIR/$name"
  tar -czf "$path" -C "$(dirname "$RUNTIME_DATA_DIR")" "$(basename "$RUNTIME_DATA_DIR")"
  local size
  size="$(du -h "$path" | cut -f1)"
  echo "[backup] created $path ($size)"
  local count=0
  for old in $(ls -1t "$RUNTIME_BACKUP_DIR"/cloud-agents-backup-*.tar.gz 2>/dev/null); do
    count=$((count + 1))
    if (( count > RUNTIME_BACKUP_RETENTION )); then
      rm -f "$old"
      echo "[backup] pruned $old"
    fi
  done
}

do_restore() {
  local backup_file="${1:-}"
  if [[ -z "$backup_file" ]]; then
    echo "restore requires a backup file path" >&2
    usage
  fi
  if [[ ! -f "$backup_file" ]]; then
    echo "backup file not found: $backup_file" >&2
    exit 1
  fi
  echo "[restore] stopping $SERVICE_NAME"
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  echo "[restore] extracting $backup_file to $(dirname "$RUNTIME_DATA_DIR")"
  tar -xzf "$backup_file" -C "$(dirname "$RUNTIME_DATA_DIR")"
  echo "[restore] starting $SERVICE_NAME"
  systemctl start "$SERVICE_NAME"
  sleep 3
  if systemctl --no-pager --full status "$SERVICE_NAME"; then
    echo "[restore] completed successfully"
  else
    journalctl -u "$SERVICE_NAME" -n 120 --no-pager || true
    exit 3
  fi
}

case "${1:-}" in
  backup)
    do_backup
    ;;
  restore)
    do_restore "${2:-}"
    ;;
  *)
    usage
    ;;
esac
