# SOLUTION — 部分任务状态很久不更新，Worker 日志里偶发卡顿

## 根因（Root Cause）

独立会话以 `application_name = faultlab_lock_holder` 对 `jobs` 表请求 **`LOCK TABLE jobs IN EXCLUSIVE MODE`** 并长时间 `pg_sleep`，在该事务提交前，Worker 对 `jobs` 的 `UPDATE` 会被阻塞，表现为任务状态不推进、Worker 侧卡顿。

## 关键证据（Key Evidence）

| 证据 | 预期 | 获取方式 |
|------|------|----------|
| 锁持有会话 | `application_name = faultlab_lock_holder` 且 `state` 非 idle | `pg_stat_activity` |
| 表级锁 | `pg_locks` 中 `jobs` 上出现 `ExclusiveLock` / 未授予的 AccessExclusive 相关等待 | `pg_locks` |
| Worker 等待 | 日志中处理间隔拉长或数据库错误 | `docker logs pipeline-worker` |

## 解决方案（Solution）

### 方案 A：终止异常会话（应急）

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE application_name = 'faultlab_lock_holder';
```

### 方案 B：避免长事务持表锁（根本）

将批处理/迁移与在线更新分离；尽量缩小锁粒度（行级而非表级）；设置 `lock_timeout` / `statement_timeout` 防止无限等待。

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 指出表级或元数据锁阻塞了 Worker 对 jobs 的更新
  - 能说明长事务 / 显式 LOCK TABLE 与现象的因果关系
  - 给出终止会话或调整锁策略的方向

partial_credit:
  - 仅提到「数据库慢」未具体到锁
  - 误判为磁盘或 CPU 瓶颈

no_credit:
  - 将根因完全归为 Redis 或网络
```

## 实现说明（Implementation Notes）

- 使用 `LOCK TABLE ... EXCLUSIVE` 放大现象以便教学；生产中更常见的是长事务未提交导致的行锁堆积，排查路径（`pg_stat_activity` / `pg_locks`）一致。

## 延伸思考（Further Reading）

- [PostgreSQL 锁监控](https://www.postgresql.org/docs/current/monitoring-locks.html)
