# Pipeline 底座（FaultLab）

与 Basecamp 平级：固定容器名 `pipeline-*`，共享 compose 场景在 `meta.yaml` 使用 `requires_shared_compose: true`。

## 容器

| 容器 | 用途 |
|------|------|
| `pipeline-postgres` | 任务表 `jobs` |
| `pipeline-redis` | 队列键 `jobs:queue`；注入键 `faultlab:inject:*` |
| `pipeline-api` | `POST /jobs`、`GET /jobs/:id`、`GET /health` |
| `pipeline-worker` | `BRPOP` 消费；日志 `[worker] … queue_lag=… took=…ms` |
| `pipeline-loader` | 持续 `POST /jobs` |

## 注入约定

- `faultlab:inject:delay_ms`：Worker 每单额外休眠（毫秒），用于积压场景。
- `faultlab:inject:api_enqueue_503`：值为 `1` 时 API 对入队返回 503。
- 场景 `inject.sh` 须含标准摘要块，且 `docker exec` 前使用 `MSYS_NO_PATHCONV=1`。
