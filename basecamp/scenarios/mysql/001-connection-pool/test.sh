#!/bin/sh
TIMEOUT=30
COUNT=0

for i in 1 2 3 4 5 6 7 8; do
  MSYS_NO_PATHCONV=1 docker exec basecamp-mysql sh -c "mysql -u root -proot -e 'SELECT SLEEP(20);' >/dev/null 2>&1" &
done

echo "[test] waiting for fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  CONNECTIONS=$(MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -Nse "SHOW STATUS LIKE 'Threads_connected'" | awk '{print $2}')

  if [ -n "$CONNECTIONS" ] && [ "$CONNECTIONS" -ge 8 ]; then
    echo "[test] PASS: connections=$CONNECTIONS"
    exit 0
  fi

  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: fault signal not observed within ${TIMEOUT}s"
exit 1
