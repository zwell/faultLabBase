# Nginx-002 支付确认页偶发「转圈很久后失败」，经网关时更明显

> **难度**：⭐⭐⭐☆☆ | **技术栈**：Nginx / Docker / Basecamp | **预计时长**：20-35 分钟  
> **前置知识**：Nginx 反向代理超时、`504` 与 upstream timed out  
> **故障显现时间窗口**：inject 后约 5-120 秒  
> **参数干预**：是（`proxy_read_timeout` 等被人为调低）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存至少 2 GB（本场景资源等级：light）
- verify 需要配置根目录 `.env` 中的 API Key（见 `.env.example`）

---

## 你会遇到什么

经网关访问时更容易出现超时或 504；在同等流量下，直连 API 端口可能更「耐打」。现象更像「链路某一跳的等待窗口过短」。

---

## 快速开始

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/nginx/002-proxy-read-timeout

./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```sh
docker logs basecamp-nginx --since 5m
MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c "grep ' 504 ' /var/log/nginx/access.log | tail -n 20"
MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c "grep -i 'timed out' /var/log/nginx/error.log | tail -n 20"
MSYS_NO_PATHCONV=1 docker exec basecamp-nginx sh -c "cat /etc/nginx/conf.d/location-faultlab.inc"
```

---

## 分析你的发现

1. 504 与 access/error 日志中的 upstream 线索是否一致？  
2. `/health` 与业务路径的差异能说明什么？  
3. 如果把超时调回合理值，你会如何验证「根因被命中」？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/nginx/002-proxy-read-timeout ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
./cli/faultlab.sh clean
```

演练结束后如修改了 `basecamp/nginx/conf.d/location-faultlab.inc`，请恢复基线片段并 `nginx -s reload`（或重建底座）。

---

## 参考资料

- https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout
