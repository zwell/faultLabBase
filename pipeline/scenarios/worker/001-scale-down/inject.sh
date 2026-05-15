#!/bin/sh
set -eu

if ! docker ps --format '{{.Names}}' | grep -q '^pipeline-worker$'; then
  echo "[ERROR] pipeline is not running (expected pipeline-worker up)."
  exit 1
fi

docker stop pipeline-worker >/dev/null 2>&1 || true

echo "=== FaultLab Inject Summary ==="
echo "scenario           : worker-001-scale-down"
echo "affected_component : pipeline-worker"
echo "inject_param       : docker stop pipeline-worker"
echo "================================"
