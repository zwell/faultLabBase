#!/bin/sh
set -eu

i=0
while [ "$i" -lt 50 ]; do
  ev=$(MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli INFO stats 2>/dev/null | awk -F: '$1=="evicted_keys"{gsub(/\r/,"",$2); print $2}')
  if [ "${ev:-0}" != "" ] && [ "${ev:-0}" -ge 1 ] 2>/dev/null; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "[ERROR] evicted_keys did not increase within timeout."
exit 1
