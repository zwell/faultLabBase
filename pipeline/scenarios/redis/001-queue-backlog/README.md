# 后台显示排队越来越多，但机器 CPU 并不高

> **难度**：⭐⭐☆☆☆ | **技术栈**：Redis / Node worker | **预计时长**：15–30 分钟  
> **前置知识**：Redis 字符串与列表、`LLEN`、应用日志  
> **故障显现时间窗口**：inject 后约 **20–40 秒** 队列长度明显上升  
> **参数干预**：是 — 通过 Redis 键人为拉长单任务处理时间以便复现（见 `SOLUTION.md`）

---

## 环境要求

- **Docker**：>= 24.0
- **可用内存**：建议 >= **2 GB**（轻量）
- **LLM**：根目录 `.env`（仅 `verify`）

---

## 你会遇到什么

任务仍在被标记处理，但完成速度明显追不上入队速度，队列长度持续上升，而宿主机 CPU 并未打满。

---

## 快速开始

```bash
export FAULTLAB_PROJECT=pipeline
export FAULTLAB_SCENARIO=pipeline/scenarios/redis/001-queue-backlog
./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli LLEN jobs:queue
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli GET faultlab:inject:delay_ms
docker logs pipeline-worker --since 5m
docker logs pipeline-api --since 5m
```

---

## 分析你的发现

- Worker 仍在运行时，哪些证据能区分「处理极慢」与「完全未消费」？
- 单任务耗时的变化会如何体现在队列深度上？

---

## 提交排查结论

```bash
./cli/faultlab.sh verify
```

---

## 清理环境

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli DEL faultlab:inject:delay_ms >/dev/null 2>&1 || true
./cli/faultlab.sh clean
```

---

## 参考资料

- [Pipeline 底座说明](../../../CLAUDE.md)
