# 报表任务一直停在排队，运营群里在催进度

> **难度**：⭐⭐☆☆☆ | **技术栈**：Docker / Redis 队列 / Node worker | **预计时长**：15–30 分钟  
> **前置知识**：容器基本操作、`docker logs`、Redis `LLEN`  
> **故障显现时间窗口**：inject 后约 **10–30 秒** 队列开始堆积  
> **参数干预**：否

---

## 环境要求

- **Docker**：>= 24.0（`docker compose` 子命令）
- **可用内存**：建议 >= **2 GB**（本场景资源等级：轻量）
- **LLM**：根目录 `.env` 配置 API Key（仅 `verify` 时需要）

---

## 你会遇到什么

异步流水线仍在接收新任务，但「处理完成」一侧像停住了一样：队列长度上升，Worker 侧没有新的处理日志。

---

## 快速开始

```bash
export FAULTLAB_PROJECT=pipeline
export FAULTLAB_SCENARIO=pipeline/scenarios/worker/001-scale-down
./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```bash
docker ps -a --filter name=pipeline-worker --format '{{.Names}} {{.Status}}'
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli LLEN jobs:queue
docker logs pipeline-api --since 5m
docker logs pipeline-loader --since 5m
```

---

## 分析你的发现

- 队列长度与 Worker 生命周期之间有什么对应关系？
- API 与 Loader 仍正常时，瓶颈最可能落在链路的哪一段？

---

## 提交排查结论

```bash
./cli/faultlab.sh verify
```

---

## 清理环境

```bash
docker start pipeline-worker 2>/dev/null || true
./cli/faultlab.sh clean
```

---

## 参考资料

- [Pipeline 底座说明](../../../CLAUDE.md)
