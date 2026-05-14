#!/bin/sh
TIMEOUT=30
COUNT=0

echo "[test] waiting for tiny tmp_table_size fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  VAL=$(MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -Nse "SHOW GLOBAL VARIABLES LIKE 'tmp_table_size';" 2>/dev/null | awk '{print $2}')
  if [ -n "$VAL" ] && [ "$VAL" -le 16384 ] 2>/dev/null; then
    echo "[test] PASS: tmp_table_size=$VAL"
    exit 0
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: tmp_table_size did not reflect inject within ${TIMEOUT}s"
exit 1
