# CLAUDE.md — FaultLab Basecamp

本文件是 Claude Code 的开发规范，**每次开始任务前必须完整读取**。
所有代码生成、文件创建、脚本编写均以本文为准。

> 平台支持：macOS / Linux / Windows（建议 Git Bash）。

---

## 项目背景

FaultLab 是一个故障排查训练平台。
Basecamp 是其「真实感底座」——一个持续运行的模拟电商系统，
供新一代基于业务剧本的故障场景使用。

学习者看到的不是"Kafka Rebalance 风暴"这个标题，而是：
> 「凌晨 2 点，订单服务 P99 延迟从 200ms 升至 4s，客服反馈有用户下单失败。」

现有场景规范见 `docs/CONTRIBUTING.md`，本文是 Basecamp 专属补充规范。

---

## 核心约束（违反即重做）

### 1. 脚本用 sh，不用 bash only 语法

```sh
# 错误
array=(1 2 3)
[[ -z "$VAR" ]]

# 正确
[ -z "$VAR" ]
```

### 2. 镜像版本必须固定，支持环境变量覆盖

```yaml
# 错误
image: mysql:latest

# 正确
image: ${MYSQL_IMAGE:-mysql:8.0.36}
```

### 3. docker-compose.yml 中容器内变量用 $$ 转义

```yaml
# 错误
command: /bin/sh -c "echo $HOSTNAME"

# 正确
command: /bin/sh -c "echo $$HOSTNAME"
```

### 4. 端口默认不暴露宿主机，必须暴露时用变量

```yaml
# 错误
ports:
  - "3306:3306"

# 正确
ports:
  - "${MYSQL_HOST_PORT:-13306}:3306"
```

### 5. 不引入 jq、rg 等额外宿主机工具

```sh
# 错误
curl ... | jq '.status'

# 正确
curl ... | grep -o '"status":"[^"]*"' | cut -d'"' -f4
```

### 6. inject.sh 必须输出标准摘要格式

```sh
echo "=== FaultLab Inject Summary ==="
echo "scenario       : mysql-001-connection-pool"
echo "affected_component : basecamp-mysql"
echo "inject_param   : max_connections=10 (was 151)"
echo "================================"
```

---

## 底座架构

### 容器清单

| 容器名 | 镜像 | 用途 |
|--------|------|------|
| `basecamp-mysql` | mysql:8.0.36 | 主数据库 |
| `basecamp-redis` | redis:7.2-alpine | 缓存 + 库存 |
| `basecamp-kafka` | apache/kafka:3.7.0 | 消息队列 |
| `basecamp-api` | node:20-alpine | 业务 API |
| `basecamp-consumer` | node:20-alpine | Kafka consumer |
| `basecamp-nginx` | nginx:1.25-alpine | 反向代理 |
| `basecamp-loader` | alpine:3.19 | 流量生成器 |

### 网络

所有容器在同一网络 `basecamp-net`，容器间用服务名通信。
loader 通过 `http://basecamp-nginx` 发请求模拟外部流量。

### 数据模型（MySQL）

```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  INDEX idx_name (name)
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  status ENUM('pending','paid','shipped','done') DEFAULT 'pending',
  total DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_status (status)
);

CREATE TABLE order_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  product_id INT NOT NULL,
  qty INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  INDEX idx_order_id (order_id)
);
```

### Redis 结构

```
product:stock:{id}     → STRING，库存数量
product:detail:{id}    → HASH，商品详情缓存，TTL 300s
session:{token}        → STRING，用户会话，TTL 1800s
```

### Kafka Topics

```
order.created       → 下单事件，partition=3
order.paid          → 支付事件，partition=3
inventory.updated   → 库存变更，partition=1
```

---

## 服务实现规范

### API 服务（services/api/index.js）

用 Node.js 原生 `http` 模块，不引入 Express 等框架。

路由：
```
GET  /health         → {"status":"ok"}
GET  /products/:id   → 先查 Redis，miss 则查 MySQL 并回填，TTL 300s
POST /orders         → 扣 Redis 库存 → 写 MySQL → 发 Kafka order.created
GET  /orders/:id     → 查 MySQL
```

日志格式（每行一条）：
```
[api] 2024-01-01T00:00:00.000Z GET /products/1 200 12ms
[api] 2024-01-01T00:00:00.000Z POST /orders 500 3012ms ERROR: connection timeout
```

### Consumer 服务（services/consumer/index.js）

消费 `order.created`，sleep 100ms 模拟积分发放处理耗时。

日志格式：
```
[consumer] 2024-01-01T00:00:00.000Z consumed order.created offset=42 lag=0 took=103ms
```

### Loader（services/loader/run.sh）

sh + curl，持续发请求，流量比例：
- 60%：GET /products/:id（随机 1-100）
- 30%：POST /orders（随机用户 + 商品）
- 10%：GET /orders/:id（随机 1-500）

每次请求后 sleep 0.1~0.5s（awk 生成随机数）。
单次请求失败打印错误后继续，不退出。

---

## inject.sh 规范

```sh
#!/bin/sh
set -e

# 1. 检查底座是否运行
if ! docker ps --format '{{.Names}}' | grep -q 'basecamp-mysql'; then
  echo "[ERROR] basecamp is not running. Run: docker compose -f basecamp/docker-compose.yml up -d"
  exit 1
fi

# 2. 注入（只改一个变量）
docker exec basecamp-mysql mysql -u root -proot \
  -e "SET GLOBAL max_connections = 10;"

# 3. 标准摘要
echo "=== FaultLab Inject Summary ==="
echo "scenario       : mysql-001-connection-pool"
echo "affected_component : basecamp-mysql"
echo "inject_param   : max_connections=10 (was 151)"
echo "================================"
```

---

## test.sh 规范

只断言一个核心故障信号，必须有超时机制：

```sh
#!/bin/sh
TIMEOUT=30
COUNT=0

echo "[test] waiting for fault signal..."
while [ $COUNT -lt $TIMEOUT ]; do
  CONNECTIONS=$(docker exec basecamp-mysql \
    mysql -u root -proot -se "SHOW STATUS LIKE 'Threads_connected'" \
    | awk '{print $2}')

  if [ "$CONNECTIONS" -ge 8 ]; then
    echo "[test] PASS: connections=$CONNECTIONS"
    exit 0
  fi

  COUNT=$((COUNT + 1))
  sleep 1
done

echo "[test] FAIL: fault signal not observed within ${TIMEOUT}s"
exit 1
```

---

## meta.yaml 新增字段

```yaml
# 现有字段（保持不变）
id: mysql-001
title: 大促窗口里，支付回调变慢、订单长时间停在处理中   # 现象标题（封面），勿剧透根因
title_reveal: 连接池打满，支付回调超时（MySQL 连接上限过低） # 揭题标题：Web 通关后替换主标题；可选
tech: mysql
difficulty: 3
duration_min: 25
duration_max: 40
resource_level: heavy
tags:
  - connection-pool
parameter_intervention: true

# 新增字段
requires_basecamp: true       # 依赖底座
business_context: payment     # 业务链路：order / payment / search / inventory
```

**`title` / `title_reveal`**：规范见 `docs/CONTRIBUTING.md` §3.0。verify 提示词只用 `title`，不用 `title_reveal`。

---

## 任务执行顺序

1. 读本文件，再读 `docs/CONTRIBUTING.md`
2. 明确要创建或修改哪些文件
3. 写代码，遵守核心约束
4. 对照约束清单自检
5. 不确定的命令或路径，先用 `docker exec` 验证后再写进脚本

### 创建新场景的标准流程

1. 创建目录 `basecamp/scenarios/<tech>/<NNN>-<desc>/`
2. `meta.yaml`（含 requires_basecamp、business_context）
3. `inject.sh`（含底座检查 + 标准摘要）
4. `scenario.md`（业务剧本，不含技术根因）
5. `README.md`（排查路径，不含根因线索）
6. `SOLUTION.md`（五个必须 section）
7. `test.sh`（单一核心断言 + 超时机制）

---

## 禁止事项

- 不在场景侧实现 verify 逻辑
- 不在 inject.sh 里同时触发多个故障
- 不在 README.md 中出现根因线索
- 不引入宿主机需要安装的额外工具（jq、python、rg 等）
- 不用 bash only 语法（[[ ]]、数组、进程替换等）
- 不写死端口号（必须用 ${VAR:-PORT} 形式）
- 不在 docker-compose.yml 的 command 中直接用 $VAR（须用 $$VAR）
