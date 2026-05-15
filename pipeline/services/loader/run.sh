#!/bin/sh
set -eu

BASE_URL="${BASE_URL:-http://pipeline-api:3000}"

echo "[loader] targeting $BASE_URL"

while true; do
  if ! curl -sS -m 5 -X POST "$BASE_URL/jobs" \
    -H "Content-Type: application/json" \
    -d '{}' >/dev/null 2>&1; then
    sleep 2
    continue
  fi
  sleep 0.4
done
