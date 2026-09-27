#!/usr/bin/env bash
# Verify the dev stack is actually answering. Uses curl -sS --fail so a refused
# connection or an HTTP error exits non-zero instead of printing nothing and
# reading as success.
set -uo pipefail

BACKEND=${BACKEND:-http://127.0.0.1:5185}
FRONTEND=${FRONTEND:-http://127.0.0.1:5174}
rc=0

check() {
  local label=$1 url=$2
  if code=$(curl -sS --fail --max-time 5 -o /dev/null -w '%{http_code}' "$url" 2>&1); then
    echo "ok   $label -> HTTP $code"
  else
    echo "FAIL $label -> $code" >&2
    rc=1
  fi
}

check "backend  $BACKEND" "$BACKEND/api/presets"
check "frontend $FRONTEND" "$FRONTEND/"

# The dev backend must never be pointed at the production file.
if [ -n "${AUTOMATIONS_PATH:-}" ] && [ "$AUTOMATIONS_PATH" = /home/rcampbell/.homeassistant/automations.yaml ]; then
  echo "FAIL AUTOMATIONS_PATH points at production" >&2
  rc=1
fi

exit $rc
