#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-kafka$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

# Topic-level cap: normal order.created JSON is larger than this limit.
TARGET_BYTES=120

MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server localhost:9092 \
  --entity-type topics \
  --entity-name order.created \
  --alter \
  --add-config "max.message.bytes=${TARGET_BYTES}"

echo "=== FaultLab Inject Summary ==="
echo "scenario           : kafka-002-message-max-bytes"
echo "affected_component : basecamp-kafka (topic order.created)"
echo "inject_param       : max.message.bytes=${TARGET_BYTES} on topic order.created"
echo "================================"
