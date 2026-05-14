#!/bin/sh
TIMEOUT=60
COUNT=0

echo "[test] waiting for topic max.message.bytes fault signal..."
while [ "$COUNT" -lt "$TIMEOUT" ]; do
  OUT=$(MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-configs.sh \
    --bootstrap-server localhost:9092 \
    --entity-type topics \
    --entity-name order.created \
    --describe 2>/dev/null || true)
  if printf "%s" "$OUT" | grep -q "max.message.bytes=120"; then
    echo "[test] PASS: topic describes max.message.bytes=120"
    exit 0
  fi
  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: topic max.message.bytes not observed within ${TIMEOUT}s"
exit 1
