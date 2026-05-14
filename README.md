# FaultLab

本地优先的故障排查演练：在可运行环境里注入故障、采集证据，用 CLI 或 Web 完成演练。

## 环境要求

- **Docker**：需已安装并可使用 `docker` 与 `docker compose`（演练底座与场景依赖容器）。
- **Shell**：仓库内脚本为 `sh` 兼容写法；在 macOS / Linux / Git Bash（Windows）下使用 CLI 与脚本即可。
- **Node.js**（可选）：仅在使用 **Web 面板**（`webapp/`）时需要；纯 CLI 演练可不装。

内存建议随场景而定；含 Kafka 等组件的底座偏重，见 `basecamp/README.md` 与各场景 `meta.yaml` 中的 `resource_level`。

## Web 面板（可选）

```sh
cd webapp && npm install && npm start
```

浏览器访问：**http://localhost:4173**（端口等见 `webapp/README.md`）。底座启动、停止等可在 Web 内完成；纯 CLI 演练见下方文档。

## 文档

| 用途 | 文档 |
|------|------|
| CLI 命令与变量 | [`docs/CLI_USAGE.md`](docs/CLI_USAGE.md) |
| 新增场景 | [`docs/ADDING_SCENARIOS.md`](docs/ADDING_SCENARIOS.md)（规范见 [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)） |
| Basecamp 说明 | [`basecamp/README.md`](basecamp/README.md) |
