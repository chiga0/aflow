#!/usr/bin/env bash
# aflow-lite self-test: runtime unit tests + web typecheck + web build.
# Set AFLOW_E2E=1 to also run the Playwright web e2e (requires a running runtime
# on $AFLOW_BASE with $AFLOW_AUTH_EMAIL / $AFLOW_AUTH_PASSWORD exported).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> runtime unit tests (offline, fake qwen)"
python3 -m unittest discover -s lite/runtime/tests

echo "==> web typecheck"
( cd lite/web && npx --no-install tsc --noEmit )

echo "==> web production build"
( cd lite/web && npx --no-install vite build >/dev/null )

echo
echo "OK: runtime tests + web typecheck + web build all passed"

if [ "${AFLOW_E2E:-0}" = "1" ]; then
  echo "==> web e2e (against ${AFLOW_BASE:-http://127.0.0.1:8765})"
  ( cd lite/web && node e2e/smoke.test.mjs )
fi
