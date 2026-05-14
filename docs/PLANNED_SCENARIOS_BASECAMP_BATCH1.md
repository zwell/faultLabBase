# Basecamp 批次场景规划（MySQL×1 · Kafka×2 · Redis×2 · Nginx×2）

本文档描述 **7 个拟新增场景** 的产品与技术规划，供评审与排期后实现。实现时须遵守 [`docs/CONTRIBUTING.md`](./CONTRIBUTING.md) 与 [`CLAUDE.md`](../CLAUDE.md)（Basecamp 场景约束）。

**底座假设**：与现有 [`basecamp/scenarios/mysql/001-connection-pool`](../basecamp/scenarios/mysql/001-connection-pool) 相同，场景运行在 **FaultLab Basecamp** 共享栈上（`basecamp/docker-compose.yml`），通过 `inject.sh` 对 **`basecamp-mysql` / `basecamp-kafka` / `basecamp-redis` / `basecamp-nginx`** 等容器执行参数或配置变更；**不**为每个场景单独再起一套 compose（与当前 `mysql-001` 模式一致）。

---

## 1. 总览

| 序号 | 目录规划 | `meta.yaml` 建议 `id` | 技术栈 | 业务链路建议 | 难度 | 资源等级 |
|------|-----------|----------------------|--------|----------------|------|----------|
| 1 | `mysql/002-*` | `mysql-002` | mysql | order 或 payment | 3 | heavy |
| 2 | `kafka/001-*` | `kafka-001` | kafka | order | 3–4 | heavy |
| 3 | `kafka/002-*` | `kafka-002` | kafka | order / inventory | 3–4 | heavy |
| 4 | `redis/001-*` | `redis-001` | redis | order / search | 2–3 | light |
| 5 | `redis/002-*` | `redis-002` | redis | inventory | 2–3 | light |
| 6 | `nginx/001-*` | `nginx-001` | nginx | order | 2–3 | light |
| 7 | `nginx/002-*` | `nginx-002` | nginx | payment | 2–3 | light |

所有场景建议统一：`requires_basecamp: true`，`meta.yaml` 含 `business_context`，`inject.sh` 含底座检查 + 标准摘要格式。

---

## 2. MySQL（1 个）

### `mysql-002` — 建议主题：临时表/内存表阈值过小，下单与报表查询变慢

**与 `mysql-001` 的差异**：001 强调 **连接数打满**；002 强调 **查询执行路径**（大量 `MEMORY` 临时表溢出到磁盘、或 `tmp_table_size` / `max_heap_table_size` 过小导致排序/分组变慢）。

| 维度 | 说明 |
|------|------|
| **业务现象（剧本层）** | 大促演练中，下单与部分列表查询 P99 升高；错误率不一定上升，但超时增多。 |
| **注入思路** | `SET GLOBAL tmp_table_size=…`、`max_heap_table_size=…` 调到极小（或配合 `table_open_cache` 收紧），在现有 loader 压力下使 `Created_tmp_disk_tables` 等指标可观测。 |
| **受影响组件** | `basecamp-mysql`；间接影响 `basecamp-api` 延迟。 |
| **关键证据方向** | `SHOW GLOBAL STATUS LIKE 'Created_tmp_disk_tables'`、`SHOW GLOBAL VARIABLES LIKE 'tmp_table_size'`；API 日志或 metrics 中慢请求。 |
| **恢复** | Web `clean` / 底座重启或 `inject` 同目录提供「恢复默认值」说明；文档中写清与生产差异（参数干预 `parameter_intervention: true`）。 |

**实现注意**：注入后需确认 **不改表结构**、不破坏后续场景；`test.sh` 只断言一个信号（例如磁盘临时表计数在超时内超过阈值）。

---

## 3. Kafka（2 个）

### `kafka-001` — 建议主题：消费组会话过短，间歇 Rebalance，积分/下游延迟

| 维度 | 说明 |
|------|------|
| **业务现象** | 订单已写入，但「下游处理」（可与 consumer 日志对齐）间歇停顿；监控上消费 lag 锯齿状、Rebalance 次数上升。 |
| **注入思路** | 通过 **broker 动态配置** 或 **consumer 侧环境**（若仅改 broker 困难，可评估改 `basecamp-consumer` 启动参数需 compose 变更——规划阶段优先 **broker 可动态项**）。候选：`group.initial.rebalance.delay.ms` 极端值、或与 consumer 的 `session.timeout.ms` / `max.poll.interval.ms` 不匹配相关说明需在实现稿中二选一并写清限制。 |
| **受影响组件** | `basecamp-kafka`、`basecamp-consumer`、（可选）`basecamp-api` 侧生产延迟。 |
| **关键证据方向** | `kafka-consumer-groups.sh --describe`；broker 日志中 `Preparing to rebalance`；consumer 日志。 |
| **资源等级** | `heavy` |

### `kafka-002` — 建议主题：单条消息/请求体上限过小，订单事件发布失败或截断

| 维度 | 说明 |
|------|------|
| **业务现象** | 部分下单失败或重试陡增；API 日志出现与 Kafka 发送相关的错误；与「大 JSON / 大 payload」相关（可与当前订单 payload 大小对齐，必要时略调 API 以放大现象——若违背「单点注入」需重新选题）。 |
| **注入思路** | 将 **`message.max.bytes`** 或 **`replica.fetch.max.bytes`**（以 KRaft 单节点镜像实际支持为准）调到低于正常业务所需；或 topic 级 `max.message.bytes`。实现前需在底座上 **验证 `kafka-configs` / 静态配置** 哪条路径可脚本化。 |
| **受影响组件** | `basecamp-kafka`、`basecamp-api`。 |
| **关键证据方向** | Broker 配置 describe；producer 错误码；`docker logs basecamp-api`。 |
| **资源等级** | `heavy` |

**实现注意**：Kafka 两条都依赖 **`apache/kafka:3.7.0` 镜像内路径**（如 `/opt/kafka/bin/...`），`inject.sh` 中 `docker exec` 一律加 `MSYS_NO_PATHCONV=1`（CONTRIBUTING 要求）。

---

## 4. Redis（2 个）

### `redis-001` — 建议主题：缓存容量过小 + 淘汰策略，热点键抖动，数据库压力升高

| 维度 | 说明 |
|------|------|
| **业务现象** | 商品详情等读接口 P99 升高；MySQL `Threads_running` 或慢查询相对基线上升（与 `mysql-001` 区分：001 偏连接打满；本场景偏「缓存未命中放大」）。 |
| **注入思路** | `CONFIG SET maxmemory` 极小 + `maxmemory-policy allkeys-lru`（或 `volatile-lru`，视 key 是否带 TTL 与现有 API 一致）。 |
| **受影响组件** | `basecamp-redis`、`basecamp-api`、`basecamp-mysql`（次生）。 |
| **关键证据方向** | `INFO stats` 中 `evicted_keys`、`keyspace_hits/misses`；API 日志。 |
| **资源等级** | `light` |

### `redis-002` — 建议主题：最大客户端连接数过低，高峰出现连接拒绝

| 维度 | 说明 |
|------|------|
| **业务现象** | 间歇性 `503`/连接错误；与连接池打满（MySQL）区分：错误信息指向 Redis 或 API 内部 Redis 客户端。 |
| **注入思路** | `CONFIG SET maxclients` 降到低于 loader+API 并发所需（谨慎选择数值，避免把 SSH 调试会话也算死——仅容器内业务流量）。 |
| **受影响组件** | `basecamp-redis`、`basecamp-api`。 |
| **关键证据方向** | `INFO clients`；`rejected_connections`；API 日志。 |
| **资源等级** | `light` |

---

## 5. Nginx（2 个）

### `nginx-001` — 建议主题：`worker_connections` 过低，并发稍高即出现大量 502

| 维度 | 说明 |
|------|------|
| **业务现象** | 流量未达大促峰值即出现批量 `502`；底座 metrics 或 curl 可复现。 |
| **注入思路** | 修改挂载的 `basecamp/nginx/nginx.conf` **或** 容器内 `nginx.conf` 副本（若仅允许 exec：可通过 `docker exec` 覆盖 conf 并 `nginx -s reload`——实现时选 **可回滚** 方案，避免与 `clean` 冲突；优先 **注入脚本写临时 conf 片段 + reload** 并在摘要中写明路径）。 |
| **受影响组件** | `basecamp-nginx`、`basecamp-loader` 观测到的 HTTP 状态码。 |
| **关键证据方向** | `nginx` access/error 日志；`worker_connections` 当前值。 |
| **资源等级** | `light` |

### `nginx-002` — 建议主题：反向代理读超时过短，上游略慢即出现 504

| 维度 | 说明 |
|------|------|
| **业务现象** | 支付/下单链路「偶发」超时；与 API 自身慢区分：同一 API 直连容器端口正常，经 nginx 超时。 |
| **注入思路** | 将 `proxy_read_timeout` / `proxy_connect_timeout` 调到极低（秒级以下需谨慎，避免 SSH 断连——仅针对 upstream 段）。可先配合轻微 API 延迟（若不做 API 改动，则依赖 loader 下自然毛刺）。 |
| **受影响组件** | `basecamp-nginx`、`basecamp-api`（表象）。 |
| **关键证据方向** | error 日志中 `upstream timed out`；`proxy_read_timeout` 配置项。 |
| **资源等级** | `light` |

**实现注意**：Nginx 两则均需评估 **reload 是否足够**、**clean/restart 是否恢复**；与「仅 inject 一件事」一致，避免与 `basecamp` 默认 conf 长期漂移——可在 `SOLUTION.md` 实现说明中写明「演练后依赖底座 restart 恢复」。

---

## 6. 文件与命名落地清单（实现阶段）

每个场景目录（示例）：

```text
basecamp/scenarios/<tech>/<NNN>-<slug>/
  meta.yaml
  inject.sh
  scenario.md
  README.md
  SOLUTION.md
  test.sh
```

- **目录名**与 `meta.id` 对齐习惯：`kafka-001` → 目录 `kafka/001-...`（与现有 `mysql/001-connection-pool` 一致）。
- **slug** 实现时再最终确定英文短名（上表用中文主题描述）。

---

## 7. 建议实现顺序（降低联调风险）

1. **Redis 两条**（`CONFIG SET` 路径清晰，回滚简单）  
2. **Nginx 两条**（配置 + reload，注意与仓库 `basecamp/nginx/nginx.conf` 的关系）  
3. **MySQL 002**（参数与观测指标需与 001 明确区分）  
4. **Kafka 两条**（broker 动态配置与镜像行为需 spike 验证后再写死 `inject.sh`）

---

## 8. 开放问题（实现前需 spike）

- **Kafka**：单节点 KRaft 下目标参数是否支持 **动态修改**；若否，是否接受「改 compose + 重启 broker」并仍算单场景注入（可能违背「inject 只 docker exec」的轻量原则，需在 PR 说明）。  
- **Nginx**：优先 **仅 exec** 还是 **修改宿主机挂载文件**（后者对 Git 工作区有副作用，通常应避免）。  
- **MySQL 002**：在现有 loader 流量下是否能稳定触发磁盘临时表；若信号弱，是否微调 loader 比例须与产品确认。

---

## 9. 与现有场景关系

| 已有场景 | 说明 |
|----------|------|
| `mysql-001` | 连接池 / `max_connections`，本批次 **不重复** 该主题。 |

---

*文档版本：规划稿；实现以 CONTRIBUTING 与当时底座镜像行为为准。*
