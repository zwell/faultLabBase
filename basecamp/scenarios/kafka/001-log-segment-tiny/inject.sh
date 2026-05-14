#!/bin/sh
set -e

if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-kafka$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

SEGMENT_BYTES=65536

MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server localhost:9092 \
  --entity-type brokers \
  --entity-name 1 \
  --alter \
  --add-config "log.segment.bytes=${SEGMENT_BYTES}"

echo "=== FaultLab Inject Summary ==="
echo "scenario           : kafka-001-log-segment-tiny"
echo "affected_component : basecamp-kafka"
echo "inject_param       : broker dynamic log.segment.bytes=${SEGMENT_BYTES}"
echo "================================"
