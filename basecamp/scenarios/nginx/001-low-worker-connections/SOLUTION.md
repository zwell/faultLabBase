# SOLUTION — Nginx worker_connections 过低，并发升高即大量 502

## 根因（Root Cause）

Nginx `events` 上下文中的 `worker_connections` 被人为调得过低，导致并发稍高时 worker 无法接受更多连接，从而在网关侧表现为大量 `502`（常伴随与 upstream/worker 相关的 error 日志线索）。

**参数干预说明**：该值为演练目的被人为调低；生产默认值通常更大，但「网关并发连接容量不足」在真实事故中并不少见（配置误改、镜像模板漂移等）。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| access 大量 502 | access.log 中 `502` 占比异常 | `grep ' 502 ' /var/log/nginx/access.log` |
| worker_connections 很低 | `events-faultlab.inc` 中数值很小 | `cat /etc/nginx/conf.d/events-faultlab.inc` |
| error 线索 | `worker_connections` / `no live upstreams` 等 | `docker logs basecamp-nginx` |

## 解决方案（Solution）

### 方案 A：恢复合理 `worker_connections` 并重载（止血，⭐ 推荐）

- 将 `events-faultlab.inc` 中的 `worker_connections` 恢复到与流量匹配的基线
- `nginx -t` 校验后 `nginx -s reload`

### 方案 B：从容量模型复核（中期）

- 结合 `worker_processes`、连接数、keepalive 与上游并发，建立网关容量基线

### 方案 C：观测与发布治理（长期）

- 对 502/499 建立按路径拆分告警，避免与业务 5xx 混淆

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 worker_connections 过低导致网关无法接受足够并发
  - 给出 access/error 日志中的关键证据
  - 恢复动作包含改回配置并重载/重启并说明验证方式

partial_credit:
  - 判断为网关问题但未定位到 worker_connections
  - 证据不足但恢复方向接近

no_credit:
  - 将根因完全归结为上游 API 自身崩溃且无证据
```

## 实现说明（Implementation Notes）

- `test.sh` 在本仓库中通过检查 `events-faultlab.inc` 内容来快速断言注入是否生效；学习排查时仍应以 access/error 日志与压测现象为主证据。
- `/health` 在基线配置中使用更长超时，避免健康检查与业务路径互相干扰；学习重点仍在业务 `location /`。

## 延伸思考（Further Reading）

- Nginx worker 连接数与操作系统 `ulimit`、文件描述符的关系
- 502 vs 504 的排障路径差异
