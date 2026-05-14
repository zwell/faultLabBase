#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-nginx$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c '
  printf "%s\n" \
    "proxy_connect_timeout 500ms;" \
    "proxy_send_timeout 500ms;" \
    "proxy_read_timeout 500ms;" \
    "proxy_buffering on;" \
    > /etc/nginx/conf.d/location-faultlab.inc
  nginx -t
  nginx -s reload
'

echo "=== FaultLab Inject Summary ==="
echo "scenario           : nginx-002-proxy-read-timeout"
echo "affected_component : basecamp-nginx"
echo "inject_param       : proxy_read_timeout=500ms (plus connect/send 500ms, nginx -s reload)"
echo "================================"
