# Nginx-001 流量还没到峰值，网关侧已成片 502，直连 API 却还算稳

> **难度**：⭐⭐☆☆☆ | **技术栈**：Nginx / Docker / Basecamp | **预计时长**：15-30 分钟  
> **前置知识**：Nginx 事件模型、access/error 日志基础  
> **故障显现时间窗口**：inject 后约 5-60 秒  
> **参数干预**：是（`worker_connections` 被人为调低）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存至少 2 GB（本场景资源等级：light）
- verify 需要配置根目录 `.env` 中的 API Key（见 `.env.example`）

---

## 你会遇到什么

并发略高于日常时，经网关的请求出现成片 502；直连 API 端口可能仍正常，现象集中在「经过 Nginx 的路径」。

---

## 快速开始

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/nginx/001-low-worker-connections

./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```sh
docker logs basecamp-nginx --since 5m
MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c "grep ' 502 ' /var/log/nginx/access.log | tail -n 20"
MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c "cat /etc/nginx/conf.d/events-faultlab.inc"
```

---

## 分析你的发现

1. 502 在 access 日志中的分布特征是什么？  
2. error 日志里是否出现与连接/worker 相关的线索？  
3. 你会如何把「上游真挂」与「网关自身并发限制」区分开？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/nginx/001-low-worker-connections ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
./cli/faultlab.sh clean
```

演练结束后如修改了 `basecamp/nginx/conf.d/events-faultlab.inc`，请将 `worker_connections` 恢复为基线值并执行 `nginx -s reload`（或重建底座）。

---

## 参考资料

- https://nginx.org/en/docs/ngx_core_module.html#worker_connections
