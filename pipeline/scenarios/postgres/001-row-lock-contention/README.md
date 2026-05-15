# 部分任务状态很久不更新，Worker 日志里偶发卡顿

> **难度**：⭐⭐⭐☆☆ | **技术栈**：PostgreSQL / 锁 | **预计时长**：20–40 分钟  
> **前置知识**：`pg_stat_activity`、`pg_locks` 基础  
> **故障显现时间窗口**：inject 后数秒内  
> **参数干预**：否

---

## 环境要求

- **Docker**：>= 24.0
- **可用内存**：建议 >= **2 GB**（中量）
- **LLM**：`.env`（verify）

---

## 你会遇到什么

任务处理链路间歇停顿，数据库侧能看到长时间活跃会话，Worker 更新 `jobs` 表时等待。

---

## 快速开始

```bash
export FAULTLAB_PROJECT=pipeline
export FAULTLAB_SCENARIO=pipeline/scenarios/postgres/001-row-lock-contention
./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```bash
MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -c \
  "SELECT pid, application_name, state, wait_event_type, wait_event, query FROM pg_stat_activity WHERE datname = current_database();"
MSYS_NO_PATHCONV=1 docker exec pipeline-postgres psql -U pipeline -d pipeline -c \
  "SELECT locktype, relation::regclass, mode, granted FROM pg_locks WHERE relation = 'jobs'::regclass;"
docker logs pipeline-worker --since 5m
```

---

## 分析你的发现

- 哪些会话持有与 `jobs` 相关的锁？
- `EXCLUSIVE` 表锁会如何影响普通 `UPDATE`？

---

## 提交排查结论

```bash
./cli/faultlab.sh verify
```

---

## 清理环境

等待后台会话结束（约 90 秒）或终止持有 `faultlab_lock_holder` 的会话后，执行：

```bash
./cli/faultlab.sh clean
```

---

## 参考资料

- [PostgreSQL 锁概述](https://www.postgresql.org/docs/current/explicit-locking.html)
