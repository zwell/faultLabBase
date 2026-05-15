# 入队接口间歇 5xx，Worker 日志却相对平静

> **难度**：⭐⭐⭐☆☆ | **技术栈**：PostgreSQL / 连接 | **预计时长**：20–35 分钟  
> **前置知识**：连接池、`ALTER ROLE ... CONNECTION LIMIT`  
> **参数干预**：是 — 人为收紧角色连接上限以放大争用（见 `SOLUTION.md`）

---

## 环境要求

- **Docker**：>= 24.0
- **可用内存**：建议 >= **2 GB**

---

## 你会遇到什么

`POST /jobs` 间歇返回 5xx，API 日志出现与连接数相关的错误，而 Worker 侧未必出现队列消费断崖。

---

## 快速开始

```bash
export FAULTLAB_PROJECT=pipeline
export FAULTLAB_SCENARIO=pipeline/scenarios/postgres/002-connection-starvation
./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```bash
docker logs pipeline-api --since 5m
MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -c "SELECT rolname, rolconnlimit FROM pg_roles WHERE rolname = 'faultlab_app';"
MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -c \
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();"
```

---

## 清理环境

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -c "ALTER ROLE faultlab_app CONNECTION LIMIT -1;" >/dev/null 2>&1 || true
./cli/faultlab.sh clean
```

---

## 参考资料

- [PostgreSQL 角色连接限制](https://www.postgresql.org/docs/current/sql-alterrole.html)
