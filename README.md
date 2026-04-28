# FaultLab

训练的是真实故障排查能力，不是背答案。

FaultLab 是一个本地优先的故障诊断训练项目。你可以在可运行的服务环境中注入中间件故障、采集证据，并通过统一 CLI 流程提交诊断结论。

## 为什么是 FaultLab

- **真实**：场景绑定到可运行服务，而不是静态题面。
- **实战**：每次演练都遵循统一闭环：启动、注入、观察、验证、清理。
- **可扩展**：按项目组织场景目录，支持批量生成和并行迭代。
- **AI 辅助**：验证流程可按结构化 rubric 评估根因分析质量。

## 你可以获得什么

- 统一 CLI：`./cli/faultlab.sh`
- 贡献规范与模板：`docs/`
- 默认可运行项目：`basecamp/`
  - 基线技术栈（MySQL / Redis / Kafka / API / Consumer / Nginx / Loader）
  - 项目内场景目录：`basecamp/scenarios/`

## 快速开始

在仓库根目录执行：

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/<tech>/<id>

./cli/faultlab.sh start
./cli/faultlab.sh inject
./cli/faultlab.sh verify
./cli/faultlab.sh clean
```

`FAULTLAB_SCENARIO` 也支持 `scenarios/<tech>/<id>` 或 `<tech>/<id>` 形式；CLI 会优先结合 `FAULTLAB_PROJECT` 解析路径。

## 仅启动 Basecamp

```sh
docker compose -f basecamp/docker-compose.yml up -d
```

## 仓库结构

- `cli/`：命令入口
- `docs/`：使用说明、贡献规范与模板
- `basecamp/`：默认项目模块

## 文档索引

- CLI 使用说明：`docs/CLI_USAGE.md`
- 贡献规范：`docs/CONTRIBUTING.md`
- Basecamp 模块规范：`basecamp/README.md`

## 路线方向

- 扩展 `basecamp` 之外的项目模块
- 增加更多业务化场景，并保持一致的评分标准
- 提升 verify 评估质量与反馈深度
