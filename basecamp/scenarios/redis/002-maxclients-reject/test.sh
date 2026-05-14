#!/bin/sh
TIMEOUT=90
COUNT=0

echo "[test] waiting for rejected_connections fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  REJECTED=$(MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli INFO stats 2>/dev/null | awk -F: '$1=="rejected_connections"{gsub(/\r/,"",$2); print $2}')
  if [ -n "$REJECTED" ] && [ "$REJECTED" -ge 1 ] 2>/dev/null; then
    echo "[test] PASS: rejected_connections=$REJECTED"
    exit 0
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: rejected_connections stayed at 0 within ${TIMEOUT}s"
exit 1
