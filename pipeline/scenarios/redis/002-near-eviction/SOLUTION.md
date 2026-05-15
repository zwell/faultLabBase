# SOLUTION — 排队忽快忽慢，偶发任务失败或重试变多

## 根因（Root Cause）

将 Redis `maxmemory-policy` 设为 `allkeys-lru` 后，先写入一批较大的 `faultlab:pad:*` 键，再将 `maxmemory` 下调到 **800000** 字节（低于当前数据集占用）。Redis 在缩容时按 LRU 淘汰键，`evicted_keys` 递增；队列键 `jobs:queue` 亦可能被逐出，导致任务丢失或失败。

**参数干预说明**：生产需为队列/working set 预留足够内存，或禁止对承载队列的 DB 使用危险淘汰策略。

## 关键证据（Key Evidence）

| 证据 | 预期 | 获取方式 |
|------|------|----------|
| 内存上限极低 | `CONFIG GET maxmemory` 约 2097152 | `redis-cli` |
| 发生淘汰 | `evicted_keys` 递增 | `INFO stats` |

## 解决方案（Solution）

### 方案 A：恢复合理内存上限或关闭淘汰

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli CONFIG SET maxmemory 0
```

### 方案 B：拆分热数据与队列实例

队列使用独立 Redis 集群并关闭对队列键的 LRU 风险（或使用专用流/消息系统）。

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 指出 maxmemory 与淘汰策略导致键被逐出
  - 说明队列数据被 LRU 淘汰的后果
  - 给出扩容或拆分实例/调整策略的方向

partial_credit:
  - 只说内存满未联系到淘汰键

no_credit:
  - 将根因完全归为 Worker bug
```

## 实现说明（Implementation Notes）

- 2MB 为刻意极端值，仅用于本地演练；与生产容量规划无关。

## 延伸思考（Further Reading）

- [Redis 内存优化](https://redis.io/docs/latest/develop/use/redis-for-queue/)
