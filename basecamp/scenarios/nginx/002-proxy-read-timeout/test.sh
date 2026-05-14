#!/bin/sh
TIMEOUT=15
COUNT=0

echo "[test] waiting for injected proxy_read_timeout fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  if MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c 'grep -q "proxy_read_timeout 500ms" /etc/nginx/conf.d/location-faultlab.inc' 2>/dev/null; then
    echo "[test] PASS: location-faultlab.inc contains proxy_read_timeout 500ms"
    exit 0
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: injected proxy timeout snippet not found within ${TIMEOUT}s"
exit 1
