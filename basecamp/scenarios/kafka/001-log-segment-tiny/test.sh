#!/bin/sh
TIMEOUT=45
COUNT=0

echo "[test] waiting for broker log.segment.bytes fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  OUT=$(MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-configs.sh \
    --bootstrap-server localhost:9092 \
    --entity-type brokers \
    --entity-name 1 \
    --describe 2>/dev/null || true)
  if printf "%s" "$OUT" | grep -q "log.segment.bytes=65536"; then
    echo "[test] PASS: broker describes log.segment.bytes=65536"
    exit 0
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: broker log.segment.bytes override not observed within ${TIMEOUT}s"
exit 1
