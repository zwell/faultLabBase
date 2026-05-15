# SOLUTION — 报表任务一直停在排队，运营群里在催进度

## 根因（Root Cause）

`pipeline-worker` 容器被停止后，Redis 列表 `jobs:queue` 中的任务不再被 `BRPOP` 消费，入队接口仍可用，因此任务长期处于 `pending`、队列长度单调上升。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|------|------------------|---------|
| Worker 未运行 | `exited` / 容器不在 `docker ps` 运行列表 | `docker ps -a --filter name=pipeline-worker` |
| 队列堆积 | `LLEN jobs:queue` 持续 > 0 且上升 | `docker exec pipeline-redis redis-cli LLEN jobs:queue` |
| 无处理日志 | 无 `[worker] ... processed job` 新行 | `docker logs pipeline-worker --since 5m` |

## 解决方案（Solution）

### 方案 A：恢复 Worker 进程（演练环境，推荐）

```bash
docker start pipeline-worker
```

### 方案 B：编排层保证最小副本数

在 Swarm/Kubernetes/Compose 中为 worker 设置 `restart` 策略与最小副本，避免单点人工停死后无人拉起。

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 指出 Worker 未运行或已退出导致无人消费队列
  - 提到 Redis 队列 `jobs:queue` 堆积与现象一致
  - 给出恢复 worker 或保证副本可用的方向
  - reality_check: 能结合 `docker ps` / `LLEN` 说明判断依据

partial_credit:
  - 只说「队列堵了」但未关联到 consumer 侧停止
  - 误将根因完全归为 Redis 或 Postgres

no_credit:
  - 将根因归结为网络分区或磁盘满且无证据
```

## 实现说明（Implementation Notes）

- 本场景通过 `docker stop pipeline-worker` 直接模拟 worker 全停。生产中常见诱因还包括 OOM 被杀、部署错误、资源配额为 0 等，现象与证据路径类似。
- 未引入多副本编排，便于在本地单机构造稳定复现。

## 延伸思考（Further Reading）

- [Redis 列表作为队列的局限与 BRPOPLPUSH 模式](https://redis.io/docs/latest/develop/data-types/lists/)
