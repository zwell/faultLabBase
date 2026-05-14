# SOLUTION — Kafka 单条消息上限过小，订单事件发布失败

## 根因（Root Cause）

`order.created` topic 被人为设置了过低的 `max.message.bytes`，使得正常大小的订单事件 JSON 无法通过 Broker 校验，从而在 API 侧表现为 Kafka 发送失败（日志中常见消息过大/记录过大类错误）。

**参数干预说明**：该 topic 限额为演练目的被人为调低；生产中更常见的是业务 payload 增长、schema 变更或误把限额改小导致的等价故障。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| topic 限额异常 | `max.message.bytes` 很小 | `kafka-configs.sh --describe`（entity-type topics） |
| 生产者失败日志 | `too large` / `RECORD_TOO_LARGE` / KafkaJS 相关错误 | `docker logs basecamp-api` |
| 失败与下单相关 | `POST /orders` 5xx 或错误文本 | `docker logs basecamp-api` |

## 解决方案（Solution）

### 方案 A：调大 topic `max.message.bytes`（止血，⭐ 推荐）

- 将限额调整到覆盖业务消息体 P99 以上余量
- 同步核对 Broker 侧 `message.max.bytes` 等上限是否存在「短板效应」

### 方案 B：控制消息体（中期）

- 避免把冗余大字段写入事件；必要时拆分事件或使用引用（id）而非全量快照

### 方案 C：变更治理（长期）

- 对 topic 配置变更加审批与回归验证

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 order.created 的 max.message.bytes 过低导致发送失败
  - 给出 kafka-configs describe 或等价配置证据
  - 恢复方案包含调大限额并说明验证方式

partial_credit:
  - 判断为 Kafka 发送失败但未定位到消息大小/限额
  - 证据不足但方向接近

no_credit:
  - 将根因归结为 MySQL 事务失败且无证据
```

## 实现说明（Implementation Notes）

- 本场景只改 topic 级限额，避免把 Broker 全局 `message.max.bytes` 调到极低而引发更大范围不可用；与「单点注入」目标一致。
- 单节点 Broker 省略了多副本一致性细节，但不影响学习「限额短板 → 生产失败」这一机制。

## 延伸思考（Further Reading）

- topic `max.message.bytes` 与 broker `message.max.bytes` 的约束关系
- 压缩（compression）对消息体检查点的影响
