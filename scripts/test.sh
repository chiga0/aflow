#!/usr/bin/env bash
# aflow self-test: runtime unit tests + web typecheck + web build.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "== runtime unit tests"
python3 -m unittest discover -s runtime/tests

echo "== web typecheck"
( cd web && npx --no-install tsc --noEmit )

echo "== web build"
( cd web && npx --no-install vite build >/dev/null )

if [ "${1:-}" = "--e2e" ]; then
  echo "== e2e smoke (needs a running runtime with AFLOW_AUTH_PASSWORD set)"
  ( cd web && node e2e/smoke.test.mjs )
fi

echo
echo "OK: runtime tests + web typecheck + web build all passed"
