# SOLUTION — MySQL 临时表阈值过小，排序与聚合查询变慢

## 根因（Root Cause）

MySQL 的 `tmp_table_size` 与 `max_heap_table_size` 被人为调到极小，使得包含排序/分组等操作的查询更容易将内部临时表从内存溢出到磁盘（`Created_tmp_disk_tables` 上升），从而抬高查询耗时并放大下单与列表路径的 P99。

**参数干预说明**：上述阈值为演练目的被人为调低；生产中更常见的是 SQL 与数据分布变化导致临时表膨胀，但「阈值过小」会显著放大同类问题。

## 关键证据（Key Evidence）

| 证据 | 预期关键字 / 内容 | 获取方式 |
|---|---|---|
| 阈值异常低 | `tmp_table_size` / `max_heap_table_size` 很小 | `SHOW GLOBAL VARIABLES` |
| 磁盘临时表增长 | `Created_tmp_disk_tables` 上升 | `SHOW GLOBAL STATUS` |
| 慢查询/耗时 | `/orders` 或列表查询耗时抬升 | `docker logs basecamp-api` |

## 解决方案（Solution）

### 方案 A：恢复合理阈值（止血，⭐ 推荐）

- 将 `tmp_table_size` / `max_heap_table_size` 恢复到与实例规格匹配的基线
- 结合监控验证 `Created_tmp_disk_tables` 增速回落

### 方案 B：优化 SQL 与索引（中期）

- 减少不必要的 `ORDER BY`/`GROUP BY`、避免 `SELECT *` 大宽表、为分组键补齐索引

### 方案 C：容量与基线（长期）

- 建立临时表相关计数与慢查询的联动告警

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 明确指出 tmp_table_size/max_heap_table_size 过小导致磁盘临时表溢出风险
  - 给出 Created_tmp_disk_tables 或等价证据
  - 恢复方案包含调参并说明验证方式

partial_credit:
  - 只判断为数据库慢但未定位到临时表/阈值
  - 证据不足但方向接近

no_credit:
  - 完全归因到网络或 Kafka 且无证据
```

## 实现说明（Implementation Notes）

- 本场景在注入后额外执行一批会触发临时表的查询以放大计数器，便于在共享底座上观测；生产里同类信号通常来自真实业务 SQL 与数据量。
- 单节点 MySQL 省略了读写分离与主从延迟因素，但不影响学习「执行路径被迫溢出」这一核心机制。

## 延伸思考（Further Reading）

- MySQL 8 内部临时表规则与 MEMORY 引擎边界
- 如何用 `EXPLAIN` 预判临时表与 filesort
