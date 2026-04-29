#!/bin/sh
set -e

# 1. 检查底座
if ! docker ps --format '{{.Names}}' | grep -q '^basecamp-mysql$'; then
  echo "[ERROR] basecamp is not running."
  exit 1
fi

# Tunables (keep in sync with intent: exhaust connections)
# Note: keep at least 1 extra slot so the lock-job (FOR UPDATE + SLEEP) can still connect.
TARGET_MAX_CONN=11
LOAD_WORKERS=20
MYSQL_DB=faultlab

# To reliably push /orders P99 into seconds:
# 1) lower max_connections (capacity pressure)
# 2) additionally lock the product row with FOR UPDATE + SLEEP
#    so /orders' own `SELECT ... FOR UPDATE` will block until we release.
LOCK_PRODUCT_ID=1
LOCK_SLEEP_SEC=15
LOCK_TOTAL_SEC=75
LOAD_TOTAL_SEC=75

# Keep user_id within valid range, otherwise /orders 会快速 400（稀释延迟分位数）
USER_MAX=$(docker exec basecamp-mysql mysql -u root -proot -D "${MYSQL_DB}" -N -se "SELECT MAX(id) FROM users;" 2>/dev/null || echo 100)
USER_MIN=1

# Avoid "insufficient stock" quick failures diluting p99.
# Reset both MySQL and Redis stock before injecting faults.
STOCK_RESET=100000

# 2. 记录注入前的连接数上限
BEFORE=$(docker exec basecamp-mysql \
  mysql -u root -proot -se "SELECT @@max_connections;" 2>/dev/null || echo "")

# 2.1 重置库存（先于故障注入）
docker exec basecamp-mysql mysql -u root -proot -D "${MYSQL_DB}" \
  -e "UPDATE products SET stock=${STOCK_RESET} WHERE id=${LOCK_PRODUCT_ID};" >/dev/null 2>&1 || true
docker exec basecamp-redis redis-cli --raw SET "product:stock:${LOCK_PRODUCT_ID}" "${STOCK_RESET}" EX 300 >/dev/null 2>&1 || true

# 3. 调低连接上限
docker exec basecamp-mysql mysql -u root -proot \
  -e "SET GLOBAL max_connections = ${TARGET_MAX_CONN};"

# 4. 行锁循环注入：每隔 LOCK_SLEEP_SEC 锁一次 products.id=${LOCK_PRODUCT_ID}
#    目标：让异常在“最近 60 秒采样窗口”里也能保持。
LOCK_SQL="START TRANSACTION; SELECT id FROM products WHERE id=${LOCK_PRODUCT_ID} FOR UPDATE; SELECT SLEEP(${LOCK_SLEEP_SEC}); COMMIT;"
docker exec basecamp-mysql sh -lc "rm -f /tmp/faultlab-lock.log 2>/dev/null || true; nohup sh -lc 'end_ts=\$((\$(date +%s) + ${LOCK_TOTAL_SEC})); while [ \$(date +%s) -lt \$end_ts ]; do mysql -u root -proot -D ${MYSQL_DB} -e \"${LOCK_SQL}\" >/dev/null 2>&1 || true; done' >/tmp/faultlab-lock.log 2>&1 &"

# 5. 给锁生效一点时间
sleep 1

# 6. 持续压请求（仅依赖 node 运行时，不依赖 curl）
docker exec basecamp-api node -e "
const http = require('http');
const endAt = Date.now() + ${LOAD_TOTAL_SEC} * 1000;
let userId = 1;
const USER_MIN = ${USER_MIN};
const USER_MAX = ${USER_MAX};
const USER_RANGE = Math.max(1, USER_MAX - USER_MIN + 1);

function oneRequest(i) {
  return new Promise((resolve) => {
    const req = http.request(
      'http://localhost:3000/orders',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      }
    );
    req.on('error', resolve);
    req.write(JSON.stringify({ user_id: i, product_id: ${LOCK_PRODUCT_ID}, qty: 1 }));
    req.end();
  });
}

async function worker() {
  while (Date.now() < endAt) {
    const i = userId;
    // Wrap user_id to valid range.
    userId = USER_MIN + ((userId - USER_MIN + 1) % USER_RANGE);
    await oneRequest(i);
  }
}

Promise.all(Array.from({ length: ${LOAD_WORKERS} }, worker)).then(() => process.exit(0));
"

# 7. 等待一小段让请求结果落到日志中
sleep 2

# 8. 标准摘要（重试避免 Too many connections 下读不到）
AFTER=""
for _ in 1 2 3; do
  AFTER=$(docker exec basecamp-mysql \
    mysql -u root -proot -N -se "SHOW STATUS LIKE 'Threads_connected';" 2>/dev/null \
    | awk '{print $2}' || echo "")
  if [ -n "$AFTER" ]; then
    break
  fi
  sleep 1
done

echo "=== FaultLab Inject Summary ==="
echo "scenario           : mysql-001-connection-pool"
echo "affected_component : basecamp-mysql"
echo "inject_param       : max_connections=${TARGET_MAX_CONN} (was ${BEFORE})"
echo "inject_param       : row_lock products.id=${LOCK_PRODUCT_ID} loop: sleep=${LOCK_SLEEP_SEC}s total=${LOCK_TOTAL_SEC}s"
echo "inject_param       : load_workers=${LOAD_WORKERS} total=${LOAD_TOTAL_SEC}s"
echo "connections_now    : ${AFTER}"
echo "================================"
