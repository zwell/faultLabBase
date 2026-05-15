#!/bin/sh
set -eu

i=0
while [ "$i" -lt 30 ]; do
  running=$(docker inspect -f '{{.State.Running}}' pipeline-worker 2>/dev/null || echo false)
  if [ "$running" != "true" ]; then
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "[ERROR] pipeline-worker still running after inject wait."
exit 1
