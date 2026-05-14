# SOLUTION — Redis 缓存容量过小，热点键频繁淘汰

## 根因（Root Cause）

Redis 被人为设置了极低的 `maxmemory`（本场景约 64KiB）并配合 `allkeys-lru` 淘汰策略，导致热点商品详情键在持续流量下频繁被淘汰。应用在读路径上更容易回落到 MySQL，从而放大数据库读压力。

**参数干预说明**：`maxmemory` 与 `maxmemory-policy` 为演练目的被人为调整；生产默认值通常不会如此激进，更多见容量规划失配或热点键设计问题导致的等价现象。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| 内存上限极低 | `maxmemory` 为很小的数值 | `CONFIG GET maxmemory` / `INFO memory` |
| 发生淘汰 | `evicted_keys` 持续增长 | `INFO stats` |
| 读路径回落数据库 | `/products` 相关日志耗时抬升 | `docker logs basecamp-api` |
| MySQL 读压力上升 | `Threads_running` 相对基线更高 | `SHOW GLOBAL STATUS LIKE 'Threads_running'` |

## 解决方案（Solution）

### 方案 A：恢复合理内存上限与策略（止血，⭐ 推荐）

- 将 `maxmemory` 调整到与业务体量匹配的容量，或取消不合理的上限（按你们规范）
- 复核 `maxmemory-policy` 是否符合业务可丢缓存的假设

### 方案 B：降低大键与无效缓存（中期）

- 控制 HASH 字段体量，避免把「整包大 JSON」塞进缓存
- 为冷热数据分层 TTL 或拆分 key 空间

### 方案 C：观测与容量基线（长期）

- 建立 `used_memory`、`evicted_keys`、命中率与 API P99 的联动告警

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 maxmemory 过低与淘汰策略导致缓存失效率上升
  - 给出 evicted_keys 或等价证据说明淘汰在发生
  - 能把读路径放大到 MySQL 的现象与证据对齐

partial_credit:
  - 只指出 Redis 慢或内存高但未落到淘汰机制
  - 证据不足但恢复方向基本正确

no_credit:
  - 归因到 Kafka 或 unrelated 组件
  - 无证据支撑或恢复动作不可执行
```

## 实现说明（Implementation Notes）

- 本场景通过 `CONFIG SET` 快速改变运行态参数，便于在共享底座上复现；生产里同类问题更多来自真实容量不足或热点设计，而不是「随手改配置」。
- Basecamp 为单节点 Redis，无副本切换因素；结论仍可迁移到「缓存命中率下降 → 读库放大」这一核心链路。

## 延伸思考（Further Reading）

- LRU/LFU 在热点抖动场景下的差异
- 多级缓存与击穿/穿透/雪崩的边界
