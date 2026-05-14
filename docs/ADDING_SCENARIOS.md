# 新增场景指南

本文面向**要写新场景或扩展场景库**的贡献者；完整规范以 [`CONTRIBUTING.md`](./CONTRIBUTING.md) 为准，这里只给路径与清单，便于快速落地。

## 先读什么

- **场景编写约定与细节**：[`docs/CONTRIBUTING.md`](./CONTRIBUTING.md)
- **学习者侧文案模板**：[`docs/README_template.md`](./README_template.md)、[`docs/SOLUTION_template.md`](./SOLUTION_template.md)

## 场景放哪里

默认项目 **Basecamp** 下，新场景放在：

```text
basecamp/scenarios/<tech>/<场景目录名>/
```

示例：`basecamp/scenarios/mysql/001-connection-pool/`。

若你新增的是**其他项目模块**，在仓库根目录 `project.yaml` 的 `projects` 里配置该项目，并设置对应的 `scenario_path`；Web 与索引会按该路径扫描含 `meta.yaml` 的目录。

## 建议具备的文件

| 文件 | 说明 |
|------|------|
| `meta.yaml` | 场景元数据（`id`、`title` / `title_reveal`、难度、`resource_level` 等），供索引与 Web |
| `inject.sh` | 注入故障，须符合仓库内 `inject.sh` 约定（摘要格式、底座检查等） |
| `README.md` | 学习者面向的排查入口，按模板写 |
| `SOLUTION.md` | 供 verify 对照的要点，按模板写 |
| `test.sh` | 单一核心断言 + 超时，见 CONTRIBUTING |
| `scenario.md` | 若使用业务剧本，可与 Web 展示约定对齐 |

是否必须自带 `docker-compose.yml`、是否依赖 Basecamp，见 **CONTRIBUTING** 中对应章节。

## 与 CLI 的关系

学习者通过环境变量指定项目与场景路径后使用统一 CLI，例如：

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/<tech>/<id>
./cli/faultlab.sh start
```

`FAULTLAB_SCENARIO` 也支持 `scenarios/<tech>/<id>` 或 `<tech>/<id>`；解析规则见 [`docs/CLI_USAGE.md`](./CLI_USAGE.md)。

## 与 Web 的关系

Web 从根目录 `project.yaml` 读取 `projects`，再按各项目的 `scenario_path` 扫描场景；新增场景放入对应路径并包含 `meta.yaml` 后，刷新 Web 即可出现在该底座的场景列表中（无需改 Web 代码）。

## 自检

提交前按 `CONTRIBUTING.md` 中的清单自检：脚本语法、镜像版本、不引入多余宿主机工具、inject 摘要格式等。
