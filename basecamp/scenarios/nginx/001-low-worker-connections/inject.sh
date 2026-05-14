#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-nginx$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c '
  printf "%s\n" "worker_connections 24;" > /etc/nginx/conf.d/events-faultlab.inc
  nginx -t
  nginx -s reload
'

echo "=== FaultLab Inject Summary ==="
echo "scenario           : nginx-001-low-worker-connections"
echo "affected_component : basecamp-nginx"
echo "inject_param       : events-faultlab.inc worker_connections=24 (nginx -s reload)"
echo "================================"
