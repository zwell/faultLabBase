# Basecamp 项目规范

## 项目名称

- **名称**：`basecamp`
- **类型**：FaultLab 项目模块
- **用途**：提供持续运行、贴近真实业务的基线环境，用于场景生成与排障训练。

## 项目简介

`basecamp` 是 FaultLab 的默认项目模块。它模拟了一个紧凑的电商业务负载，并作为 `basecamp/scenarios/` 下各类场景目录的运行底座。

本文档偏规范说明，面向贡献者、自动化工具和批量生成/维护场景的 AI Agent。

## 技术栈

- **运行时**：Docker Compose
- **API**：Node.js（原生 `http` 模块）
- **数据层**：MySQL 8.0、Redis 7.2
- **消息系统**：Kafka 3.7
- **流量入口**：Nginx
- **流量生成**：Alpine + sh + curl

## 核心拓扑

- `basecamp-mysql`
- `basecamp-redis`
- `basecamp-kafka`
- `basecamp-api`
- `basecamp-consumer`
- `basecamp-nginx`
- `basecamp-loader`

所有服务运行在 `basecamp-net` 网络中，通过 `basecamp/docker-compose.yml` 统一启动。

## 目录约定

- `docker-compose.yml`：本项目基线基础设施定义
- `mysql/init.sql`：数据库表结构与种子数据
- `nginx/nginx.conf`：入口反向代理配置
- `services/`：运行服务实现（`api`、`consumer`、`loader`）
- `scenarios/`：本项目场景集合（可批量生成，也可人工维护）

## 场景扩展策略

本项目新增场景必须放在：

- `basecamp/scenarios/<tech>/<id>/`

推荐文件集合（按场景类型选用）：

- `meta.yaml`
- `inject.sh`
- `README.md`
- `SOLUTION.md`
- `test.sh`
- `docker-compose.yml`（仅当场景不是 `requires_shared_compose: true` / `requires_basecamp: true` 时需要）

## 基线运行方式

在仓库根目录执行：

```sh
docker compose -f basecamp/docker-compose.yml up -d
docker compose -f basecamp/docker-compose.yml ps
```

## CLI 集成

运行场景时建议使用项目感知变量：

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/<tech>/<id>
./cli/faultlab.sh start
```

`FAULTLAB_SCENARIO` 也支持 `scenarios/<tech>/<id>` 与 `<tech>/<id>` 两种写法。

## 维护说明

- 镜像版本保持固定，并允许通过环境变量覆盖。
- 脚本避免依赖宿主机额外工具。
- 本文档需与 `docs/CONTRIBUTING.md` 和 CLI 行为保持一致。
