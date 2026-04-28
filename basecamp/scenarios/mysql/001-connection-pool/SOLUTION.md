# SOLUTION — 连接池打满，支付回调超时

## 根因（Root Cause）

本场景通过参数干预将 MySQL `max_connections` 调整为 10（默认通常为 151），
在持续业务流量下快速触发连接资源紧张，导致支付回调链路等待连接并出现超时。
该参数在真实生产中通常不会被直接调低到如此激进值，更多是容量规划失配或连接泄漏造成等价现象。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| 连接上限配置 | `max_connections = 10` | `SHOW VARIABLES LIKE 'max_connections'` |
| 活跃连接数接近上限 | `Threads_connected >= 8` | `SHOW STATUS LIKE 'Threads_connected'` |
| API 请求耗时升高 | `POST /orders` 耗时抬升或报错 | `docker logs basecamp-api --since 5m` |

## 解决方案（Solution）

### 方案 A：恢复连接上限（立即止血）

```sql
SET GLOBAL max_connections = 151;
```

### 方案 B：连接池与并发控制（中期治理）

- 校准应用连接池上限与数据库容量上限
- 给高峰链路加并发保护与超时退避

### 方案 C：容量压测与告警（长期防再发）

- 大促前执行连接容量压测
- 对 `Threads_connected`、等待时延建立告警阈值

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 max_connections 被调低导致连接资源受限
  - 给出 Threads_connected 接近上限等关键证据
  - 提供可执行的恢复动作并说明验证方式

partial_credit:
  - 仅指出数据库瓶颈但未定位到连接上限
  - 证据不完整或恢复方案过于笼统

no_credit:
  - 归因到无关组件（如 Kafka 或 Redis）
  - 无关键证据或恢复动作不可执行
```

## 实现说明（Implementation Notes）

- 本实验通过直接修改 `max_connections` 快速制造故障窗口，属于可控注入手段。
- 与真实生产相比，单机环境简化了网络与多副本因素，但不影响连接资源耗尽的核心机理。

## 延伸思考（Further Reading）

- 如何在应用层避免连接泄漏放大故障？
- 如何用压测数据反推数据库与连接池的容量基线？
