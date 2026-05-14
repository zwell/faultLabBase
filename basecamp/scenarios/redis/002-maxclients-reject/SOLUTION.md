# SOLUTION — Redis 最大客户端数过低，连接被拒绝

## 根因（Root Cause）

Redis 的 `maxclients` 被人为调低到低于底座在「API + loader」并发下的连接需求，导致 Redis 在高峰期拒绝新连接（`rejected_connections` 上升），从而在应用侧表现为间歇性错误。

**参数干预说明**：`maxclients` 为演练目的被人为调低；生产中更常见的是连接泄漏或短连接风暴把连接数打满，但观测信号与处理思路高度相似。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| 连接上限异常低 | `maxclients` 明显偏小 | `CONFIG GET maxclients` |
| 拒绝连接计数上升 | `rejected_connections > 0` | `INFO stats` |
| 当前连接数逼近上限 | `connected_clients` 接近 `maxclients` | `INFO clients` |
| 应用侧报错 | Redis 连接类错误关键词 | `docker logs basecamp-api` |

## 解决方案（Solution）

### 方案 A：调回合理 `maxclients`（止血，⭐ 推荐）

- 将 `maxclients` 调整到与实例规格与并发模型匹配的值
- 同步检查应用连接池上限是否「合理且可控」

### 方案 B：治理连接泄漏与短连接（中期）

- 排查是否存在未复用连接、异常重试风暴、健康检查方式导致的连接放大

### 方案 C：容量与告警（长期）

- 对 `connected_clients`、`rejected_connections` 建立阈值告警

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 maxclients 过低导致连接拒绝
  - 给出 rejected_connections 或等价证据
  - 恢复方案包含调参或降并发并说明验证方式

partial_credit:
  - 只判断为 Redis 不稳定但未定位到 maxclients/拒绝连接
  - 恢复方向正确但缺少关键证据

no_credit:
  - 归因到 MySQL 连接池或无关网络问题且无证据
```

## 实现说明（Implementation Notes）

- 本场景用 `CONFIG SET maxclients` 与「先抬高上限、再压满连接、再回落到当前连接数」的方式制造 `rejected_connections`；其中 `SUBSCRIBE` 会话用于稳定占用连接位，属于演练手段，不等价于生产中的常态流量。
- 单节点 Redis 省略了哨兵/集群切换因素，但不影响学习「连接上限 → 拒绝连接 → 业务报错」这一链路。

## 延伸思考（Further Reading）

- 客户端连接池参数与 Redis 服务端连接上限如何联合评估
- TLS/代理层对连接数统计的影响
