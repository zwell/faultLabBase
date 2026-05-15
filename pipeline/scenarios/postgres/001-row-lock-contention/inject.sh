#!/bin/sh
set -eu

if ! docker ps --format '{{.Names}}' | grep -q '^pipeline-postgres$'; then
  echo "[ERROR] pipeline is not running."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -t -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'faultlab_lock_holder';" >/dev/null 2>&1 || true

MSYS_NO_PATHCONV=1 docker exec pipeline-postgres sh -c \
  "nohup psql -U pipeline -d pipeline -v ON_ERROR_STOP=1 -c \"BEGIN; SET application_name TO 'faultlab_lock_holder'; LOCK TABLE jobs IN EXCLUSIVE MODE; SELECT pg_sleep(90); COMMIT;\" >/tmp/faultlab-lock.log 2>&1 &"

echo "=== FaultLab Inject Summary ==="
echo "scenario           : postgres-001-row-lock-contention"
echo "affected_component : pipeline-postgres"
echo "inject_param       : background session LOCK TABLE jobs EXCLUSIVE + pg_sleep(90s)"
echo "================================"
