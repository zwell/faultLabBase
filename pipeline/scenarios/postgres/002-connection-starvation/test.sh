#!/bin/sh
set -eu

# After inject, API + worker should hold two faultlab_app sessions under loader pressure.
sleep 4

if MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U faultlab_app -d pipeline -c "SELECT 1" 2>&1 | grep -qi 'too many connections for role'; then
  exit 0
fi

echo "[ERROR] extra faultlab_app connection was not rejected (expected role limit reached)."
exit 1
