# SOLUTION — 后台显示排队越来越多，但机器 CPU 并不高

## 根因（Root Cause）

Worker 在处理每个任务前会读取 Redis 键 `faultlab:inject:delay_ms`，若存在则将其毫秒数叠加到单任务休眠上。演练中该值被设为 **12000ms**，在 Loader 持续入队的前提下，消费速率远低于到达速率，`jobs:queue` 长度持续上升；因主要是睡眠等待而非 CPU 计算，故 CPU 不一定升高。

**参数干预说明**：生产默认无此键；本键仅用于缩短「慢消费」复现时间，便于观察背压。

## 关键证据（Key Evidence）

| 证据 | 预期 | 获取方式 |
|------|------|----------|
| 注入键存在 | `GET faultlab:inject:delay_ms` 返回 `12000` | `redis-cli GET` |
| 队列变长 | `LLEN jobs:queue` 明显 > 基线 | `redis-cli LLEN jobs:queue` |
| Worker 仍在跑 | 仍有 `[worker] ... took=` 日志且 `took` 很大 | `docker logs pipeline-worker` |

## 解决方案（Solution）

### 方案 A：移除注入延迟（推荐）

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli DEL faultlab:inject:delay_ms
```

### 方案 B：优化业务处理或水平扩展 Worker

降低单任务耗时、增加 worker 副本、或拆分热点队列。

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 指出单任务处理被人为拉长或配置过慢导致吞吐不足
  - 提到 Redis 键 faultlab:inject:delay_ms 或等价的「每单额外延迟」机制
  - 解释队列变长与 CPU 不高可同时成立
  - reality_check: 承认本场景含参数干预键

partial_credit:
  - 只描述积压未说明消费侧变慢原因
  - 误判为 Worker 完全停止

no_credit:
  - 将根因完全归为 Redis 内存或网络
```

## 实现说明（Implementation Notes）

- 延迟通过 Redis 动态注入，无需重建镜像；与生产中通过配置中心/环境变量调参类似，但键名与行为为演练专用。

## 延伸思考（Further Reading）

- [Little's Law 与队列稳定条件](https://en.wikipedia.org/wiki/Little%27s_law)
