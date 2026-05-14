#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-mysql$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

MYSQL_DB=faultlab
TMP_TABLE_BYTES=8192
HEAP_TABLE_BYTES=8192

BEFORE_TMP=$(MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -Nse "SELECT @@tmp_table_size;" 2>/dev/null || echo "")
BEFORE_HEAP=$(MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -Nse "SELECT @@max_heap_table_size;" 2>/dev/null || echo "")

MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -e \
  "SET GLOBAL tmp_table_size=${TMP_TABLE_BYTES}; SET GLOBAL max_heap_table_size=${HEAP_TABLE_BYTES};" >/dev/null

# Warm queries to materialize on-disk internal temp tables under tiny memory thresholds.
i=0
while [ "$i" -lt 30 ]; do
  MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -D "${MYSQL_DB}" -Nse \
    "SELECT o.user_id FROM orders o JOIN order_items i ON i.order_id=o.id GROUP BY o.user_id ORDER BY o.id DESC LIMIT 200;" \
    >/dev/null 2>&1 || true
  i=$((i + 1))
done

echo "=== FaultLab Inject Summary ==="
echo "scenario           : mysql-002-tmp-table-disk-spill"
echo "affected_component : basecamp-mysql"
echo "inject_param       : tmp_table_size=${TMP_TABLE_BYTES} (was ${BEFORE_TMP})"
echo "inject_param       : max_heap_table_size=${HEAP_TABLE_BYTES} (was ${BEFORE_HEAP})"
echo "inject_param       : warmed_disk_tmp_queries=30"
echo "================================"
