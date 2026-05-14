# SOLUTION — Kafka Broker 日志段过小，生产与消费抖动加剧

## 根因（Root Cause）

Kafka Broker 被人为通过动态配置将 `log.segment.bytes` 调到极小（本场景为 65536 字节），导致日志段滚动与相关元数据/文件系统操作频率显著上升，从而在持续流量下放大生产与消费的抖动与长尾延迟。

**参数干预说明**：该值为演练目的被人为调低；生产中更常见的是默认值合理但磁盘或清理策略异常，或误把段大小改到不适合业务吞吐的水平。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| Broker 动态配置 | `log.segment.bytes=65536` | `kafka-configs.sh --describe` 并检索 `log.segment.bytes` |
| Broker 日志线索 | rolling / segment / log 相关高频信息 | `docker logs basecamp-kafka` |
| 消费侧现象 | lag 或处理耗时抖动 | `kafka-consumer-groups.sh --describe` / `docker logs basecamp-consumer` |

## 解决方案（Solution）

### 方案 A：删除/恢复 Broker 动态覆盖（止血，⭐ 推荐）

- 使用 `kafka-configs.sh --alter --delete-config log.segment.bytes` 回到集群默认推导值（以平台规范为准）
- 观察滚动频率与延迟是否回落

### 方案 B：按吞吐与保留策略重设段大小（中期）

- 将 `log.segment.bytes` 与磁盘带宽、保留周期、压缩策略联合评估

### 方案 C：容量与变更治理（长期）

- 对 Broker 关键动态配置变更加审批与回归验证

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 log.segment.bytes 过小导致日志段滚动过频并放大抖动
  - 给出 kafka-configs describe 或等价配置证据
  - 恢复方案包含删除/调整该配置并说明验证方式

partial_credit:
  - 判断为 Kafka Broker 压力但未定位到日志段/segment 相关机制
  - 证据不足但恢复方向接近

no_credit:
  - 将根因完全归结为业务代码死循环且无证据
```

## 实现说明（Implementation Notes）

- 本场景使用 KRaft 单节点 Broker 支持的动态配置项 `log.segment.bytes`；不同版本可动态修改集合可能不同，以你环境 `kafka-configs.sh` 实际行为为准。
- 与规划文档中「消费组会话过短」主题不同：在 Apache Kafka 3.7.0 镜像中，`group.*session*` 等项不支持动态修改，因此本仓库实现改为可脚本化且可观测的 **日志段过小** 作为 Kafka-001 的替代注入面。

## 延伸思考（Further Reading）

- `log.segment.bytes` 与 `log.roll.ms` / `log.roll.hours` 的协同
- 高频滚动对 page cache 与磁盘 IOPS 的影响
