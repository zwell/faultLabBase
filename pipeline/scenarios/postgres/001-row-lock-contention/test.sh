#!/bin/sh
set -eu

i=0
while [ "$i" -lt 40 ]; do
  c=$(MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -t -A -c \
    "SELECT count(*)::text FROM pg_stat_activity WHERE application_name = 'faultlab_lock_holder' AND state <> 'idle'" 2>/dev/null | tr -d '\r' || echo 0)
  if [ "${c:-0}" -ge 1 ]; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "[ERROR] lock holder session not observed."
exit 1
