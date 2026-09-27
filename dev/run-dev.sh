#!/usr/bin/env bash
# AquaLight dev runner — isolated from production on the same host.
#
# Production on robix is nginx :80 -> backend :5175, reading and writing
# /home/rcampbell/.homeassistant/automations.yaml. This script touches none of
# that: the backend runs on :5185 against a scratch copy of automations.yaml,
# and the Vite dev server runs on :5174 proxying /api there.
#
#   ./dev/run-dev.sh            start both, seeding the scratch file if absent
#   ./dev/run-dev.sh --reseed   re-copy the live automations.yaml first
set -euo pipefail

DEV_DIR=${DEV_DIR:-/tmp/aqualight-dev}
DEV_AUTOMATIONS="$DEV_DIR/automations.yaml"
LIVE_AUTOMATIONS=${LIVE_AUTOMATIONS:-/home/rcampbell/.homeassistant/automations.yaml}
PROD_AUTOMATIONS=/home/rcampbell/.homeassistant/automations.yaml
BACKEND_PORT=${BACKEND_PORT:-5185}
FRONTEND_PORT=${FRONTEND_PORT:-5174}
# Bind loopback IPv4 explicitly: the default resolves to [::1] only, which
# silently refuses IPv4 clients. From your Mac, tunnel instead of exposing:
#   ssh -L 5174:127.0.0.1:5174 -L 5185:127.0.0.1:5185 robix
DEV_HOST=${DEV_HOST:-127.0.0.1}

# Refuse to run if the dev target resolves to the production file. The whole
# point of this script is that a mistake here cannot reach production.
if [ "$(readlink -f "$DEV_AUTOMATIONS" 2>/dev/null || echo "$DEV_AUTOMATIONS")" = "$PROD_AUTOMATIONS" ]; then
  echo "REFUSING: dev automations path resolves to the production file." >&2
  exit 1
fi
if [ "$BACKEND_PORT" = "5175" ]; then
  echo "REFUSING: :5175 is the production backend port." >&2
  exit 1
fi

mkdir -p "$DEV_DIR/presets"

if [ "${1:-}" = "--reseed" ] || [ ! -f "$DEV_AUTOMATIONS" ]; then
  if [ -r "$LIVE_AUTOMATIONS" ]; then
    cp "$LIVE_AUTOMATIONS" "$DEV_AUTOMATIONS"
    echo "seeded $DEV_AUTOMATIONS from $LIVE_AUTOMATIONS ($(wc -c < "$DEV_AUTOMATIONS") bytes)"
  else
    echo "[]" > "$DEV_AUTOMATIONS"
    echo "WARNING: could not read $LIVE_AUTOMATIONS; seeded an empty list instead" >&2
  fi
fi

cleanup() { [ -n "${BACK_PID:-}" ] && kill "$BACK_PID" 2>/dev/null || true; }
trap cleanup EXIT

# HA_TOKEN deliberately empty: no calls reach Home Assistant from dev.
AUTOMATIONS_PATH="$DEV_AUTOMATIONS" \
PRESETS_DIR="$DEV_DIR/presets" \
HA_TOKEN= \
PORT="$BACKEND_PORT" \
  python3 backend/app.py &
BACK_PID=$!
echo "backend  : http://127.0.0.1:$BACKEND_PORT  (automations: $DEV_AUTOMATIONS)"

AQUALIGHT_API="http://127.0.0.1:$BACKEND_PORT" \
AQUALIGHT_PORT="$FRONTEND_PORT" \
  npx vite --host "$DEV_HOST" --port "$FRONTEND_PORT" --strictPort
