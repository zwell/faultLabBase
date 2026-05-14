# FaultLab Web（`webapp/`）

## 启动

在仓库根目录或 `webapp/` 下执行：

```sh
cd webapp
npm install
npm start
```

## 访问

浏览器打开：**http://localhost:4173**

- 默认监听 `0.0.0.0:4173`，本机用 `http://localhost:4173` 即可。
- 修改端口或仅本机访问示例：

```sh
PORT=8080 HOST=127.0.0.1 npm start
```

## 数据来源

- 项目/底座列表来自仓库根目录的 `project.yaml`。
- 场景列表由各项目的 `scenario_path` 扫描含 `meta.yaml` 的目录。

## 常用 API（节选）

- `GET /api/health` — 健康检查
- `GET /api/basecamps` — 底座列表与运行状态
- `GET /api/basecamps/:id` — 底座详情
- `POST /api/basecamps/:id/start|stop|restart|clean` — 启动/停止/重启/清理（对应 `docker compose`）
- `GET /api/basecamps/:id/scenarios` — 场景列表
- `GET /api/basecamps/:id/containers` — 容器状态
- WebSocket `GET /api/terminal?...` — 本机/容器终端（详见 `server.js`）

前端开发约定见同目录 `CLAUDE.md`。
