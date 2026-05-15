# 前端点「生成报表」经常直接失败，状态码偏 5xx

> **难度**：⭐⭐☆☆☆ | **技术栈**：HTTP API / Redis 特性开关 | **预计时长**：10–25 分钟  
> **参数干预**：是 — 通过 Redis 键强制入队返回 503（见 `SOLUTION.md`）

---

## 环境要求

- **Docker**：>= 24.0

---

## 你会遇到什么

`POST /jobs` 大量返回 503，API 日志出现 `injected_enqueue_reject` 类描述（若已实现）。

---

## 快速开始

```bash
export FAULTLAB_PROJECT=pipeline
export FAULTLAB_SCENARIO=pipeline/scenarios/api/001-enqueue-503
./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```bash
docker logs pipeline-api --since 5m
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli GET faultlab:inject:api_enqueue_503
MSYS_NO_PATHCONV=1 docker exec pipeline-loader sh -c 'curl -sS -o /dev/null -w "%{http_code}\\n" -X POST http://pipeline-api:3000/jobs -H "Content-Type: application/json" -d "{}"'
```

---

## 清理环境

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli DEL faultlab:inject:api_enqueue_503 >/dev/null 2>&1 || true
./cli/faultlab.sh clean
```

---

## 参考资料

- [HTTP 503 语义](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/503)
