# SOLUTION — Nginx 反向代理读超时过短，上游略慢即 504

## 根因（Root Cause）

Nginx 在反向代理到 `basecamp-api` 的路径上被人为设置了极低的 `proxy_read_timeout`（本场景同时收紧 connect/send），导致上游响应只要略慢于阈值，就会在网关侧以 `504` 结束（error 日志常见 `upstream timed out` 类线索）。

**参数干预说明**：超时阈值为演练目的被人为调低；生产中更常见的是默认值合理但上游偶发抖动，或误把超时改太小。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| access 出现 504 | access.log 中 `504` | `grep ' 504 ' /var/log/nginx/access.log` |
| upstream timed out | error.log 关键字 | `grep -i timed /var/log/nginx/error.log` |
| 配置证据 | `location-faultlab.inc` 出现极小的 `proxy_read_timeout` | `docker exec basecamp-nginx cat /etc/nginx/conf.d/location-faultlab.inc` |
| 对照实验 | 直连 API 端口相对更稳定 | 在容器网络内对比 curl |

## 解决方案（Solution）

### 方案 A：调回合理代理超时并重载（止血，⭐ 推荐）

- 将 `proxy_read_timeout` / `proxy_connect_timeout` / `proxy_send_timeout` 调整到与上游 P99 匹配的余量
- `nginx -t` 后 `nginx -s reload`

### 方案 B：治理上游抖动（中期）

- 优化慢 SQL、外部依赖、锁竞争等导致的上游长尾

### 方案 C：分层超时策略（长期）

- 对关键路径与健康检查使用不同 `location` 超时策略，避免一刀切

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出代理读超时过短导致 504
  - 给出 access/error 日志证据或配置证据闭环
  - 恢复方案包含调回超时并说明验证方式

partial_credit:
  - 判断为网关超时但未指出 proxy_read_timeout
  - 证据不完整但方向正确

no_credit:
  - 仅归结为业务代码死循环且无证据
```

## 实现说明（Implementation Notes）

- `test.sh` 在本仓库中通过检查 `location-faultlab.inc` 内容来快速断言注入是否生效；学习排查时仍应以 access/error 日志与对照直连为主证据。
- 与生产差异在于：这里用更小阈值让现象在轻负载下也可出现。

## 延伸思考（Further Reading）

- `proxy_read_timeout` 与 `send_timeout`/`client_body_timeout` 的边界
- 网关超时与应用超时如何分层协同
