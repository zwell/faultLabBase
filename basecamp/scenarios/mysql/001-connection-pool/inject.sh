#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-mysql$'; then
  echo "[ERROR] basecamp is not running. Run: docker compose -f basecamp/docker-compose.yml up -d"
  exit 1
fi

BEFORE=$(MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -Nse "SHOW VARIABLES LIKE 'max_connections'" | awk '{print $2}')

MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -e "SET GLOBAL max_connections = 10;" >/dev/null

sleep 5

AFTER=$(MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -Nse "SHOW VARIABLES LIKE 'max_connections'" | awk '{print $2}')

echo "=== FaultLab Inject Summary ==="
echo "scenario       : mysql-001-connection-pool"
echo "affected_component : basecamp-mysql"
echo "inject_param   : max_connections=${AFTER} (was ${BEFORE})"
echo "================================"
