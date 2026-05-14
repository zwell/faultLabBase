#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-redis$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

BEFORE_MAX=$(MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG GET maxmemory | awk 'NR==2{print}')
BEFORE_POLICY=$(MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG GET maxmemory-policy | awk 'NR==2{print}')

# Very small on purpose: forces eviction under loader GET /products traffic.
TARGET_MAXMEMORY=65536

MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG SET maxmemory "${TARGET_MAXMEMORY}" >/dev/null
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG SET maxmemory-policy allkeys-lru >/dev/null

echo "=== FaultLab Inject Summary ==="
echo "scenario           : redis-001-cache-eviction-pressure"
echo "affected_component : basecamp-redis"
echo "inject_param       : maxmemory=${TARGET_MAXMEMORY} (was ${BEFORE_MAX})"
echo "inject_param       : maxmemory-policy=allkeys-lru (was ${BEFORE_POLICY})"
echo "================================"
