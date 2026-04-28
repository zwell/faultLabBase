#!/bin/sh

BASE_URL="http://basecamp-nginx"
SEED=$(date +%s)

request() {
  method="$1"
  path="$2"
  data="$3"

  if [ "$method" = "POST" ]; then
    out=$(curl -sS -o /tmp/loader_body.$$ -w "%{http_code} %{time_total}" -X POST -H "Content-Type: application/json" --data "$data" "$BASE_URL$path" 2>/dev/null)
    code=$?
  else
    out=$(curl -sS -o /tmp/loader_body.$$ -w "%{http_code} %{time_total}" "$BASE_URL$path" 2>/dev/null)
    code=$?
  fi

  if [ $code -ne 0 ]; then
    echo "[loader] $method $path 000 0ms ERROR"
    rm -f /tmp/loader_body.$$
    return 1
  fi

  status=$(echo "$out" | awk '{print $1}')
  seconds=$(echo "$out" | awk '{print $2}')
  took_ms=$(awk -v t="$seconds" 'BEGIN { printf "%d", (t * 1000) + 0.5 }')

  if [ "$status" -ge 500 ] 2>/dev/null; then
    echo "[loader] $method $path $status ${took_ms}ms ERROR"
  else
    echo "[loader] $method $path $status ${took_ms}ms"
  fi

  rm -f /tmp/loader_body.$$
  return 0
}

while true; do
  values=$(awk -v seed="$SEED" 'BEGIN {
    srand(seed);
    pick=int(rand()*100);
    product=int(rand()*100)+1;
    user=int(rand()*100)+1;
    qty=int(rand()*3)+1;
    order=int(rand()*500)+1;
    slp=0.1+rand()*0.4;
    printf "%d %d %d %d %d %.3f", pick, product, user, qty, order, slp;
  }')
  SEED=$((SEED + 1))

  pick=$(echo "$values" | awk '{print $1}')
  product_id=$(echo "$values" | awk '{print $2}')
  user_id=$(echo "$values" | awk '{print $3}')
  qty=$(echo "$values" | awk '{print $4}')
  order_id=$(echo "$values" | awk '{print $5}')
  sleep_secs=$(echo "$values" | awk '{print $6}')

  if [ "$pick" -lt 60 ]; then
    request "GET" "/products/$product_id" ""
  elif [ "$pick" -lt 90 ]; then
    payload=$(printf '{"user_id":%s,"product_id":%s,"qty":%s}' "$user_id" "$product_id" "$qty")
    request "POST" "/orders" "$payload"
  else
    request "GET" "/orders/$order_id" ""
  fi

  sleep "$sleep_secs"
done
