#!/bin/sh
set -eu

if ! docker ps --format '{{.Names}}' | grep -q '^pipeline-redis$'; then
  echo "[ERROR] pipeline is not running."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli CONFIG SET maxmemory 0 >/dev/null
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli CONFIG SET maxmemory-policy allkeys-lru >/dev/null

MSYS_NO_PATHCONV=1 docker exec pipeline-redis sh -c 'i=0; while [ "$i" -lt 80 ]; do VAL=$(dd if=/dev/urandom bs=2000 count=1 2>/dev/null | base64 | tr -d "\n"); redis-cli SET "faultlab:pad:$i" "$VAL" >/dev/null; i=$((i+1)); done'

MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli CONFIG SET maxmemory 800000 >/dev/null

echo "=== FaultLab Inject Summary ==="
echo "scenario           : redis-002-near-eviction"
echo "affected_component : pipeline-redis"
echo "inject_param       : padded keys then maxmemory=800000 bytes + allkeys-lru"
echo "================================"
