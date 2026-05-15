#!/bin/sh
set -eu

if ! docker ps --format '{{.Names}}' | grep -q '^pipeline-postgres$'; then
  echo "[ERROR] pipeline is not running."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -v ON_ERROR_STOP=1 -c \
  "ALTER ROLE faultlab_app CONNECTION LIMIT 2;" >/dev/null

echo "=== FaultLab Inject Summary ==="
echo "scenario           : postgres-002-connection-starvation"
echo "affected_component : pipeline-postgres"
echo "inject_param       : ALTER ROLE faultlab_app CONNECTION LIMIT 2"
echo "================================"
