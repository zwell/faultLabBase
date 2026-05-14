# MySQL-002 演练期间下单与列表查询同时变慢，超时变多但错误率不高

> **难度**：⭐⭐⭐☆☆ | **技术栈**：MySQL / Docker / Basecamp | **预计时长**：25-40 分钟  
> **前置知识**：MySQL 临时表、`tmp_table_size` / `max_heap_table_size`、状态计数器  
> **故障显现时间窗口**：inject 后约数秒起可持续  
> **参数干预**：是（临时表内存阈值被人为调低）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存至少 2 GB（本场景资源等级：heavy）
- verify 需要配置根目录 `.env` 中的 API Key（见 `.env.example`）

---

## 你会遇到什么

下单与部分列表查询同时变慢；错误率未必飙升，但超时增多。数据库侧与「临时表/排序」相关的信号更容易被放大。

---

## 快速开始

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/mysql/002-tmp-table-disk-spill

./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```sh
docker logs basecamp-api --since 5m
MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -e "SHOW GLOBAL VARIABLES WHERE Variable_name IN ('tmp_table_size','max_heap_table_size');"
MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -e "SHOW GLOBAL STATUS LIKE 'Created_tmp_disk_tables';"
MSYS_NO_PATHCONV=1 docker exec basecamp-mysql mysql -u root -proot -e "SHOW PROCESSLIST;"
```

---

## 分析你的发现

1. 临时表相关计数与慢查询/耗时之间如何对齐？  
2. 你会如何证明「不是单纯缺索引」而是「执行路径被迫溢出」？  
3. 恢复时优先调整哪些参数，为什么？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/mysql/002-tmp-table-disk-spill ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
./cli/faultlab.sh clean
```

---

## 参考资料

- https://dev.mysql.com/doc/refman/8.0/en/internal-temporary-tables.html
