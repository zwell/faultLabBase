#!/bin/sh
set -eu

if ! docker ps --format '{{.Names}}' | grep -q '^pipeline-redis$'; then
  echo "[ERROR] pipeline is not running."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli SET faultlab:inject:delay_ms 12000 >/dev/null

echo "=== FaultLab Inject Summary ==="
echo "scenario           : redis-001-queue-backlog"
echo "affected_component : pipeline-redis / pipeline-worker"
echo "inject_param       : SET faultlab:inject:delay_ms=12000 (worker extra sleep per job)"
echo "================================"
