#!/bin/sh
set -eu

i=0
while [ "$i" -lt 40 ]; do
  if MSYS_NO_PATHCONV=1 docker logs pipeline-api --since 3m 2>&1 | grep -q 'POST /jobs 503'; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "[ERROR] POST /jobs 503 log line not found."
exit 1
