# MySQL-001 大促窗口里，支付回调变慢，订单长时间停在处理中

> **难度**：⭐⭐⭐☆☆ | **技术栈**：MySQL / Docker / Basecamp | **预计时长**：25-40 分钟
> **前置知识**：MySQL 连接数指标、应用请求超时排查
> **故障显现时间窗口**：inject 后约 5-30 秒
> **参数干预**：是（max_connections 被人为调低）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存至少 2 GB（本场景资源等级：heavy）

---

## 你会遇到什么

支付回调链路在流量持续存在时出现明显抖动，
接口 P99 延迟从毫秒级升到秒级，部分订单长时间停在处理中。

---

## 快速开始

### 1. 启动底座

```sh
docker compose -f basecamp/docker-compose.yml up -d
```

### 2. 注入故障

```sh
sh basecamp/scenarios/mysql/001-connection-pool/inject.sh
```

---

## 观察与排查

```sh
docker logs basecamp-api --since 5m
docker exec basecamp-mysql mysql -u root -proot -e "SHOW VARIABLES LIKE 'max_connections';"
docker exec basecamp-mysql mysql -u root -proot -e "SHOW STATUS LIKE 'Threads_connected';"
docker exec basecamp-mysql mysql -u root -proot -e "SHOW PROCESSLIST;"
```

---

## 分析你的发现

1. 延迟抬升与哪些数据库运行信号同步出现？
2. 连接相关指标在故障窗口内的趋势是什么？
3. 恢复动作应该先做哪一步，为什么？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/mysql/001-connection-pool ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
docker compose -f basecamp/docker-compose.yml down -v
```

---

## 参考资料

- https://dev.mysql.com/doc/refman/8.0/en/server-status-variables.html
- https://dev.mysql.com/doc/refman/8.0/en/server-system-variables.html
