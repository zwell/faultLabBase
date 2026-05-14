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

## 问题分析（LLM）

场景详情页「问题分析」会读取该场景目录下的 `SOLUTION.md`（仅服务端，不通过列表接口下发），调用大模型判断学习者结论与参考答案的匹配度并返回导师式回复（**SSE 流式**）。

默认使用 **DeepSeek**（OpenAI 兼容接口）。环境变量：

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（默认提供商时使用） |
| `LLM_API_KEY` | 通用 Key：在未设置提供商专用 Key 时作为回退 |
| `LLM_PROVIDER` | `deepseek`（默认）或 `openai` |
| `OPENAI_API_KEY` | 当 `LLM_PROVIDER=openai` 时使用 |
| `LLM_API_BASE` | 可选，覆盖 API 根路径（默认 DeepSeek：`https://api.deepseek.com/v1`，OpenAI：`https://api.openai.com/v1`） |
| `LLM_MODEL` | 可选，覆盖模型名（默认 `deepseek-chat` / `gpt-4o-mini`） |
| `LLM_TIMEOUT_MS` | 可选，上游超时毫秒数（默认 `120000`） |

### 密钥从哪里来？

- **终端里 `npm start`**：继承当前 shell 的环境。若你在 `~/.zshrc` 里 `export DEEPSEEK_API_KEY=...`，用 **交互式 zsh 打开终端再启动**，Node 能直接读到，**无需** `.env`。
- **从 Cursor / IDE / 未登录 shell 启动**：往往**不会**加载 `.zshrc`，此时可用 **`.env`**：在仓库根目录或 `webapp/` 下复制 `.env.example` 为 `.env`（见仓库根目录 **`.env.example`**）。服务启动时会先读根目录 `.env`，再读 `webapp/.env`；**仅当某变量在环境中尚未定义时**才写入，因此 **shell 里已 export 的变量优先于文件**。

答对后服务端会将该场景标记为已完成并持久化到 `webapp/.scenario-analysis-state.json`（已加入 `.gitignore`）。列表与详情接口中的 `analysis_status` 为 `not_started` 或 `completed`。

## 常用 API（节选）

- `GET /api/health` — 健康检查（含 `llm_ready` 是否已配置可用模型）
- `GET /api/ui-config` — 前端开关（含 `llmReady`）
- `GET /api/basecamps` — 底座列表与运行状态
- `GET /api/basecamps/:id` — 底座详情
- `POST /api/basecamps/:id/start|stop|restart|clean` — 启动/停止/重启/清理（对应 `docker compose`）
- `GET /api/basecamps/:id/scenarios` — 场景列表（含 `analysis_status`）
- `GET /api/basecamps/:id/scenarios/:scenarioId` — 场景详情（含 `analysis_status`）
- `POST /api/basecamps/:id/scenarios/:scenarioId/verify` — 提交分析；**响应为 `text/event-stream`（SSE）**：事件 `type: token` 增量正文，`type: done` 含 `verdict`、`analysis_status`、`reply_full`；`type: error` 为失败
- `GET /api/basecamps/:id/containers` — 容器状态
- WebSocket `GET /api/terminal?...` — 本机/容器终端（详见 `server.js`）

前端开发约定见同目录 `CLAUDE.md`。
