# Redis-001 商品详情读接口 P99 抬升，数据库读压力跟着上来

> **难度**：⭐⭐☆☆☆ | **技术栈**：Redis / Docker / Basecamp | **预计时长**：20-35 分钟  
> **前置知识**：Redis 内存与淘汰策略、`INFO` 基本读法  
> **故障显现时间窗口**：inject 后约 10-60 秒  
> **参数干预**：是（`maxmemory` 与 `maxmemory-policy` 被人为调整）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存至少 2 GB（本场景资源等级：light）
- 提交结论（verify）需要在仓库根目录配置 `.env` 中的模型 API Key，详见根目录 `.env.example`

---

## 你会遇到什么

商品详情等读路径延迟抬升，MySQL 读压力相对基线上升；错误率未必立刻飙升，但体感「缓存没扛住」。

---

## 快速开始

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/redis/001-cache-eviction-pressure

./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```sh
docker logs basecamp-api --since 5m
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli INFO memory
MSYS_NO_PATHCONV=1 docker exec basecamp-redis redis-cli INFO stats
MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -e "SHOW GLOBAL STATUS LIKE 'Threads_running';"
```

---

## 分析你的发现

1. 缓存命中与未命中相关指标如何变化？  
2. 该变化与 MySQL 压力之间的时间关系是什么？  
3. 你会优先验证「容量」还是「键分布 / TTL」？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/redis/001-cache-eviction-pressure ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
./cli/faultlab.sh clean
```

---

## 参考资料

- https://redis.io/docs/latest/develop/reference/eviction/
