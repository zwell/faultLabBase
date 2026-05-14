#!/bin/sh
TIMEOUT=15
COUNT=0

echo "[test] waiting for injected worker_connections fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  if MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c 'grep -q "worker_connections 24" /etc/nginx/conf.d/events-faultlab.inc' 2>/dev/null; then
    echo "[test] PASS: events-faultlab.inc contains worker_connections 24"
    exit 0
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: injected worker_connections snippet not found within ${TIMEOUT}s"
exit 1
