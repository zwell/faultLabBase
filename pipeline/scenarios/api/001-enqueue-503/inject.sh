#!/bin/sh
set -eu

if ! docker ps --format '{{.Names}}' | grep -q '^pipeline-redis$'; then
  echo "[ERROR] pipeline is not running."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli SET faultlab:inject:api_enqueue_503 1 >/dev/null

echo "=== FaultLab Inject Summary ==="
echo "scenario           : api-001-enqueue-503"
echo "affected_component : pipeline-api (via pipeline-redis flag)"
echo "inject_param       : SET faultlab:inject:api_enqueue_503=1"
echo "================================"
