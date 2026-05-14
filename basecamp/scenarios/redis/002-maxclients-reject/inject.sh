#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-redis$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

BEFORE=$(MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG GET maxclients | awk 'NR==2{print}')

# Give ourselves headroom to create a lot of blocking subscribers, then clamp to "exactly full".
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG SET maxclients 200 >/dev/null

i=0
while [ "$i" -lt 40 ]; do
  MSYS_NO_PATHCONV=1 docker exec -d basecamp-redis sh -c "exec redis-cli SUBSCRIBE __faultlab_hold_${i} >/dev/null 2>&1"
  i=$((i + 1))
done

sleep 2

NOW=$(MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli INFO clients 2>/dev/null | awk -F: '$1=="connected_clients"{gsub(/\r/,"",$2); print $2}')
if [ -z "$NOW" ] || [ "$NOW" -lt 1 ] 2>/dev/null; then
  echo "[ERROR] could not read connected_clients"
  exit 1
fi

# At capacity: new connection attempts should be rejected.
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG SET maxclients "${NOW}" >/dev/null

i=0
while [ "$i" -lt 120 ]; do
  MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli PING >/dev/null &
  i=$((i + 1))
done
wait

echo "=== FaultLab Inject Summary ==="
echo "scenario           : redis-002-maxclients-reject"
echo "affected_component : basecamp-redis"
echo "inject_param       : maxclients clamped to connected_clients=${NOW} (was ${BEFORE})"
echo "inject_param       : held_subscribers=40 parallel_ping_burst=120"
echo "================================"
