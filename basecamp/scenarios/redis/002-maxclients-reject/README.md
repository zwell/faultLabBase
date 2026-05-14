# Redis-002 库存链路间歇出现连接类错误，重试次数变多

> **难度**：⭐⭐☆☆☆ | **技术栈**：Redis / Docker / Basecamp | **预计时长**：15-30 分钟  
> **前置知识**：Redis `INFO clients`、连接拒绝相关指标  
> **故障显现时间窗口**：inject 后约 10-90 秒  
> **参数干预**：是（`maxclients` 被人为调低）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存至少 2 GB（本场景资源等级：light）
- verify 需要配置根目录 `.env` 中的 API Key（见 `.env.example`）

---

## 你会遇到什么

间歇性 503 或连接类错误，错误信息可能指向 Redis 或应用侧 Redis 客户端；与 MySQL 连接池打满相比，证据更偏「Redis 侧资源拒绝」。

---

## 快速开始

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/redis/002-maxclients-reject

./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```sh
docker logs basecamp-api --since 5m
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli INFO clients
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli INFO stats
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli CONFIG GET maxclients
```

---

## 分析你的发现

1. 连接数与拒绝计数如何随时间变化？  
2. 峰值是否与 loader 流量窗口对齐？  
3. 你会如何区分「客户端泄漏」与「服务端上限过低」？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/redis/002-maxclients-reject ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
./cli/faultlab.sh clean
```

如你刚跑过 `redis-002` 的注入脚本，Redis 可能仍存在大量 `SUBSCRIBE` 会话；若后续排查异常，可在容器内执行 `redis-cli CLIENT KILL TYPE pubsub` 或重启 `basecamp-redis`。

---

## 参考资料

- https://redis.io/docs/latest/develop/reference/clients/
