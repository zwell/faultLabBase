#!/bin/sh
TIMEOUT=60
COUNT=0

echo "[test] waiting for evicted_keys fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  EVICTED=$(MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli INFO stats 2>/dev/null | awk -F: '$1=="evicted_keys"{gsub(/\r/,"",$2); print $2}')
  if [ -n "$EVICTED" ] && [ "$EVICTED" -ge 1 ] 2>/dev/null; then
    echo "[test] PASS: evicted_keys=$EVICTED"
    exit 0
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: evicted_keys did not increase within ${TIMEOUT}s"
exit 1
