# 排队忽快忽慢，偶发任务失败或重试变多

> **难度**：⭐⭐⭐☆☆ | **技术栈**：Redis 内存与淘汰 | **预计时长**：15–30 分钟  
> **参数干预**：是 — `maxmemory` 与淘汰策略被调至极端值（见 `SOLUTION.md`）

---

## 环境要求

- **Docker**：>= 24.0
- **可用内存**：建议 >= **2 GB**

---

## 你会遇到什么

Redis 内存逼近上限后，部分键可能被 LRU 淘汰，队列与注入键行为变得不稳定，任务出现丢失或重试。

---

## 快速开始

```bash
export FAULTLAB_PROJECT=pipeline
export FAULTLAB_SCENARIO=pipeline/scenarios/redis/002-near-eviction
./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli CONFIG GET maxmemory
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli CONFIG GET maxmemory-policy
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli INFO stats | grep evicted
```

---

## 清理环境

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli CONFIG SET maxmemory 0 >/dev/null 2>&1 || true
./cli/faultlab.sh clean
```

---

## 参考资料

- [Redis eviction](https://redis.io/docs/latest/develop/reference/eviction/)
