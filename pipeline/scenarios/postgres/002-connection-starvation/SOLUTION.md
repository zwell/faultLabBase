# SOLUTION — 入队接口间歇 5xx，Worker 日志却相对平静

## 根因（Root Cause）

`ALTER ROLE faultlab_app CONNECTION LIMIT 2` 将应用角色 `faultlab_app`（非超级用户）的并发连接上限收紧到 **2**。API 与 Worker 在稳态下通常各占 1 条连接；任何第三条以该角色登录的会话（含连接池扩容、手工 `psql`）都会被拒绝，入队路径在获取连接失败时返回 5xx；已持有连接的会话可能仍短暂成功，故两侧表象可能不对称。

**参数干预说明**：生产默认值通常为无限制（`-1`）；此处为教学目的人为收紧。

## 关键证据（Key Evidence）

| 证据 | 预期 | 获取方式 |
|------|------|----------|
| 角色连接上限 | `rolconnlimit = 2` | `SELECT rolconnlimit FROM pg_roles WHERE rolname='faultlab_app'` |
| 拒绝第三条连接 | `FATAL: too many connections for role "faultlab_app"` | 手工 `psql -U faultlab_app` 或应用扩容时 |
| 活跃连接数 | `faultlab_app` 会话接近或触顶上限 | `pg_stat_activity` 过滤 `usename='faultlab_app'` |

## 解决方案（Solution）

### 方案 A：恢复默认连接限制

```sql
ALTER ROLE faultlab_app CONNECTION LIMIT -1;
```

### 方案 B：调大上限或降低池大小

协调 API/Worker 的 `max` 池配置与数据库 `max_connections` / 角色 `CONNECTION LIMIT`。

## 评分要点（Scoring Rubric）

```yaml
full_credit:
  - 指出数据库侧连接上限或 max_connections 导致 API 拿不到连接
  - 能解释 Worker 与 API 表现可能不一致
  - 给出调上限或降池的修复方向

partial_credit:
  - 只提到连接池未关联数据库拒绝原因

no_credit:
  - 将根因完全归为 Redis 或代码 bug 且无证据
```

## 实现说明（Implementation Notes）

- 使用角色级 `CONNECTION LIMIT` 而非全局 `max_connections`，便于在单容器 Postgres 内稳定复现。

## 延伸思考（Further Reading）

- [PgBouncer 与连接风暴](https://www.pgbouncer.org/)
