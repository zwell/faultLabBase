# SOLUTION — 前端点「生成报表」经常直接失败，状态码偏 5xx

## 根因（Root Cause）

Redis 键 `faultlab:inject:api_enqueue_503` 被置为 `1` 时，API 在 `POST /jobs` 路径上直接返回 **503**，模拟上游过载、熔断或人为演练开关被误打开导致的入队拒绝。

**参数干预说明**：该键为演练专用；生产应通过配额、限流、熔断器实现可控退化，而非固定全拒。

## 关键证据（Key Evidence）

| 证据 | 预期 | 获取方式 |
|------|------|----------|
| 注入开关 | `GET faultlab:inject:api_enqueue_503` 为 `1` | `redis-cli` |
| API 日志 | `POST /jobs 503` 与 `injected_enqueue_reject` | `docker logs pipeline-api` |

## 解决方案（Solution）

### 方案 A：关闭注入开关

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-redis redis-cli DEL faultlab:inject:api_enqueue_503
```

### 方案 B：产品化限流与降级

返回结构化错误码、客户端重试退避、队列旁路写入本地等。

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 指出入队接口被配置/开关强制返回 503 或等价拒绝
  - 提到 Redis 键 faultlab:inject:api_enqueue_503 或「演练开关」
  - 给出移除开关或修正发布配置的修复方向

partial_credit:
  - 只说 API 挂了未说明 503 语义

no_credit:
  - 将根因完全归为数据库锁或队列满
```

## 实现说明（Implementation Notes）

- 503 在应用层生成，用于稳定复现「入队失败」而不依赖真实过载。

## 延伸思考（Further Reading）

- [Retry-After 与 503](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After)
