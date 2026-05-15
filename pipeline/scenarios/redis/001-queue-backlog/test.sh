#!/bin/sh
set -eu

i=0
while [ "$i" -lt 45 ]; do
  n=$(MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli LLEN jobs:queue 2>/dev/null | tr -d '\r' || echo 0)
  if [ "${n:-0}" -ge 3 ]; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "[ERROR] jobs:queue length did not reach 3 within timeout."
exit 1
