# FaultLab 场景编写指南

本文档是 **FaultLab 场景库的编写约定**，面向**场景贡献者**（人类或 AI 辅助工具）。
新增或修改场景时，**以本文为准**，保持「简单、一致、可教」。

> 学习者面向的文档规范见 [`docs/README_template.md`](./README_template.md) 和 [`docs/SOLUTION_template.md`](./SOLUTION_template.md)。

---

## 1. 设计原则

### 1.1 简单优先
能用一条命令说清楚的事，不要拆成多份中间产物。学习者心智负担越小越好。

### 1.2 注入是核心
故障复现的主路径是：`start` → `inject`。  
`inject.sh` 负责把环境推到「可观察的故障态」，并在终端输出清晰的摘要（键值对格式），既供人阅读，也便于后续喂给 LLM。

### 1.3 判卷交给外层 verify
学习者用自然语言描述根因；**由外层 `verify` 模块调用 LLM，对照 `SOLUTION.md` 给出引导或评分**。  
场景侧不写判卷逻辑，只负责提供清晰的 `SOLUTION.md`。

`SOLUTION.md` 的评分要点（Scoring Rubric）质量直接决定 verify 效果，请认真编写。

### 1.4 统一 CLI 语义
所有场景通过 `./cli/faultlab.sh` 暴露相同的四个命令：

| 命令 | 职责 | 场景侧是否需要实现 |
|------|------|--------------------|
| `start` | 拉起 docker compose 环境 | 提供 `docker-compose.yml` 即可 |
| `inject` | 触发故障，打印摘要 | **必须** 提供 `inject.sh` |
| `verify` | 启动 LLM 交互评分 | 由外层统一实现，场景侧无需提供 |
| `clean` | 销毁容器和临时文件 | 外层统一实现，特殊清理在 `inject.sh` 末尾处理 |

### 1.5 工具选用优先级

按以下顺序选择工具，**只在上一级无法满足时才降级**，且降级须在 PR / commit message 中说明理由：

1. **系统工具**：`sh`、`awk`、`sed`、`curl`、`grep` 等 POSIX 标准工具
2. **中间件自带工具**：如 Kafka 的 `kafka-topics.sh`、`kafka-consumer-groups.sh`，MySQL 的 `mysqladmin`
3. **语言运行时**：Python、Node.js 等——**非必要不引入额外镜像**

目标是让环境尽可能简单：学习者只需要 Docker，不需要在宿主机安装任何语言环境。

### 1.6 可移植、少依赖
- 脚本兼容 Git Bash / Linux / macOS；优先 `sh` 语法，避免依赖 `rg`、`jq` 等本机工具。
- 容器内命令使用镜像内**确定存在**的路径（如 `/opt/kafka/bin/...`）。
- **Git Bash / Windows**：在所有 `docker exec` 调用前加 `MSYS_NO_PATHCONV=1`，防止 MSYS 路径转换污染容器内路径。`inject.sh` 和 `test.sh` 均须遵守。示例：
  ```sh
  MSYS_NO_PATHCONV=1 docker exec broker /opt/kafka/bin/kafka-topics.sh --list
  ```

### 1.7 场景资源分级

每个场景必须在 `meta.yaml` 中声明资源等级，便于学习者按自己的机器配置筛选场景：

| 等级 | 标注值 | 典型技术栈 | 预计内存占用 |
|------|--------|-----------|-------------|
| 🟢 轻量 | `light` | Redis、Nginx、etcd | < 512M |
| 🟡 中量 | `medium` | MySQL、PostgreSQL、MongoDB | 512M–1G |
| 🔴 重量 | `heavy` | Kafka、Elasticsearch、Flink | > 1G |

内存估算以场景所有容器加总为准，写入 `meta.yaml` 的 `resource_level` 字段。

---

## 2. 目录结构

```
faultlab/
  <project>/
    scenarios/
      <tech>/
        <scenario-id>/
          meta.yaml            # 必须（场景元数据，供前端索引）
          docker-compose.yml   # 必须
          inject.sh            # 必须
          README.md            # 必须（学习者面向，见模板）
          SOLUTION.md          # 必须（verify/LLM 面向，见模板）
          test.sh              # 必须
  cli/
    faultlab.sh
  docs/
    CONTRIBUTING.md          # 本文件
    README_template.md
    SOLUTION_template.md
  .env.example               # API Key 配置示例
```

**命名约定**

- `<tech>`：小写，如 `kafka`、`mysql`、`redis`
- `<scenario-id>`：`NNN-短横线描述`，如 `001-rebalance-slow-consumer`
- 场景编号在同一 `<tech>` 下唯一即可，无需全局唯一
- 容器名必须带完整场景 ID 前缀，格式统一为 `{tech}{NNN}-{role}`，如 `kafka001-broker`

---

## 3. 各文件职责

### 3.0 `meta.yaml`（场景元数据）

供前端读取，用于场景列表展示和筛选。**字段名和格式不可随意修改**，前端依赖此结构。

```yaml
id: kafka-001                          # 与目录名一致，格式 {tech}-{NNN}
title: Kafka 消费者 Rebalance 风暴      # 简短标题，用于前端列表
tech: kafka                            # 技术栈，小写
difficulty: 2                          # 1–5，1 最简单
duration_min: 30                       # 预计最短完成时间（分钟）
duration_max: 45                       # 预计最长完成时间（分钟）
resource_level: heavy                  # light / medium / heavy（见 1.7 节）
tags:                                  # 关键词，用于前端筛选
  - consumer-group
  - rebalance
  - lag
parameter_intervention: false          # 是否人为修改了关键中间件参数
```

### 3.1 `docker-compose.yml`

- 必须能被 `docker compose -f <path>/docker-compose.yml up -d` 直接拉起。
- 镜像版本必须固定（如 `apache/kafka:x.x.x`），可通过环境变量覆盖（如 `${KAFKA_IMAGE:-apache/kafka:x.x.x}`）。
- 健康检查命令须与镜像一致（`apache/kafka` 无 `bash`，用 `/bin/sh`）。
- 容器名称必须带场景 ID 前缀，格式见第 2 节命名约定，避免多场景并行时冲突。
- **端口暴露策略（强约束）**：
  - 默认不暴露宿主机端口（优先使用容器内命令、容器网络通信）。
  - 若确需暴露，禁止写死常见端口（如 `9092:9092`）；必须使用可覆盖变量（如 `"${KAFKA_HOST_PORT:-19092}:9092"`）。
  - `README.md` 必须说明该端口用途与覆盖方式（环境变量名、默认值）。
  - 新场景提交前需确认：与同技术栈已存在场景并行启动时不发生端口冲突。
- **Compose 变量转义**：`command` / `entrypoint` 中的容器内 shell 变量必须写成 `$$VAR`，防止被 Compose 预插值。示例：
  ```yaml
  command: /bin/sh -c "for i in $$(seq 1 100); do echo $$i; done"
  ```

### 3.2 `inject.sh`

**职责**：触发故障，使现象可观察；在结束前打印标准摘要。

**摘要格式**（固定，便于 LLM 解析）：

```
=== FaultLab Inject Summary ===
scenario       : <scenario-id>
<key1>         : <value1>
<key2>         : <value2>
...
================================
```

**摘要 key 命名约定**：使用小写下划线，优先复用以下通用 key（如适用），保持跨场景一致性：

| key | 含义 |
|-----|------|
| `lag_before` / `lag_after` | 消费延迟（消息队列类） |
| `error_rate` | 错误率 |
| `latency_ms` | 延迟（毫秒） |
| `affected_component` | 受影响的组件名 |
| `inject_param` | 注入的核心参数或操作描述 |

**规范**：
- 只做一件事：切换到故障态。不负责验证、不负责收尾。
- 通过环境变量暴露可调节的参数（如 `INJECT_DELAY_MS=5000`），并在 `README.md` 中说明默认值。
- 在场景目录内 `cd` 后执行 `docker compose`，保证相对路径正确。
- 所有 `docker exec` 调用前加 `MSYS_NO_PATHCONV=1`。
- **关键参数干预**：默认应基于中间件的生产默认值制造故障，不得随意修改关键判定参数。若确实需要修改，必须：
  1. 在 `meta.yaml` 中将 `parameter_intervention` 设为 `true`
  2. 在 `README.md` 元信息中显式标注 `参数干预: 是`
  3. 在 `SOLUTION.md` 的根因节说明"该参数被人为调低，生产中是否常见"

### 3.3 `README.md`（学习者面向）

按 [`README_template.md`](./README_template.md) 编写，必须包含：

- **环境要求**：Docker 版本、可用内存下限、API Key 配置说明（首要位置）
- **难度 / 技术栈 / 前置知识**（文件头部元信息，与 `meta.yaml` 保持一致）
- **你会遇到什么**：现象描述，不涉及根因
- **快速开始**：`start` → `inject` 两步命令
- **观察与排查**：可用命令列表，不附带解读提示
- **分析你的发现**：引导性问题，不给答案
- **提交排查结论**：`verify` 入口说明
- **清理环境**：`clean` 命令
- **参考资料**：相关文档链接

**不要**在 README 中提及 `SOLUTION.md` 的具体内容，也不要出现任何根因线索。

### 3.4 `SOLUTION.md`（verify / LLM 面向）

按 [`SOLUTION_template.md`](./SOLUTION_template.md) 编写，必须包含以下 section（**标题不可更改**，verify 模块通过标题定位内容）：

| Section 标题 | 用途 |
|---|---|
| `## 根因（Root Cause）` | 精确的技术根因描述 |
| `## 关键证据（Key Evidence）` | 可观测信号与预期值的对照表 |
| `## 解决方案（Solution）` | 分方案的修复步骤，标注推荐程度 |
| `## 评分要点（Scoring Rubric）` | YAML 格式，`full_credit` / `partial_credit` / `no_credit` 三级 |
| `## 实现说明（Implementation Notes）` | 本实验与真实生产的差异说明（必填） |
| `## 延伸思考（Further Reading）` | 可选，深入探索方向与链接 |

### 3.5 `test.sh`（必须提供）

**目标**：验证「环境可以启动、注入不报错、故障信号可观测」，不做判卷。

**断言编写规范**：
- 所有 `docker exec` 调用前加 `MSYS_NO_PATHCONV=1`
- 必须有超时机制（`while` + 计数器），不能无限等待
- 超时时 `exit 1` 并打印明确的失败原因
- 只断言**一个最核心的故障信号**，不做多重验证（保持简单）

---

## 4. 与 `cli/faultlab.sh` 的协作约定

- 场景切换支持项目变量：
  - `FAULTLAB_PROJECT=<project>`（默认 `basecamp`）
  - `FAULTLAB_SCENARIO=<project>/scenarios/<tech>/<id>`（相对 `faultlab` 根）
- `verify` 命令由外层统一实现：读取当前场景的 `SOLUTION.md`，结合用户配置的 API Key 启动 LLM 交互；场景侧无需、也不应提供 `verify.sh`。
- API Key 通过根目录 `.env` 文件配置（格式见 `.env.example`），`faultlab.sh` 负责读取并传递给 verify 模块，场景侧无需关心。

---

## 5. 新场景发布自检清单

提交前逐项确认：

- [ ] `meta.yaml`：所有字段填写完整，`resource_level` 与实际内存占用吻合
- [ ] `meta.yaml`：`parameter_intervention` 字段与实际情况一致
- [ ] `docker-compose.yml`：`up -d` 可正常拉起，健康检查通过
- [ ] `docker-compose.yml`：容器内 shell 变量已写成 `$$VAR`
- [ ] `docker-compose.yml`：容器名带场景 ID 前缀，格式符合 `{tech}{NNN}-{role}` 约定
- [ ] `docker-compose.yml`：端口策略符合规范（默认不暴露；必须暴露时使用 `${VAR:-PORT}`，且并行启动不冲突）
- [ ] `inject.sh`：执行后有标准格式摘要输出，无报错
- [ ] `inject.sh`：所有 `docker exec` 前加了 `MSYS_NO_PATHCONV=1`
- [ ] `inject.sh`：摘要 key 优先复用通用 key 名
- [ ] `inject.sh`：若修改了关键参数，`meta.yaml` / `README.md` 已标注，`SOLUTION.md` 已说明
- [ ] `inject.sh`：未引入额外语言运行时；若引入，已在 PR 中说明理由
- [ ] `README.md`：包含环境要求区块（Docker 版本、内存下限、API Key 配置说明）
- [ ] `README.md`：按模板编写，无根因线索泄露，元信息与 `meta.yaml` 一致
- [ ] `SOLUTION.md`：五个必须 section 齐全，`评分要点` 为合法 YAML，`实现说明` 已填写
- [ ] `test.sh`：启动验证和故障信号断言均通过
- [ ] `inject.sh` 的可调参数已在 `README.md` 中说明默认值

---

## 6. 与 verify / LLM 的接口约定

```
verify 模块输入：
  - SOLUTION.md 全文（LLM 读取）
  - 学习者自述文本（交互输入）
  - inject 摘要（可选，学习者粘贴）
  - 用户 API Key（从 .env 读取，由 faultlab.sh 传入）

verify 模块输出：
  - 是否正确（基于 Scoring Rubric）
  - 缺少哪些关键证据
  - 下一步排查建议

场景侧职责边界：
  - 只负责提供高质量的 SOLUTION.md
  - 不为 verify 增加任何额外落盘文件
  - 不处理 API Key，不调用任何外部服务
```

---

## 7. 文档维护约定

- 若产品方向变更，**先改本文，再改场景**，避免各处 README 互相矛盾。
- 根目录 `README.md` 面向 **Web UI 使用者**（安装、启动、Verify 配置）；纯命令行流程见 `docs/CLI_USAGE.md`；场景编写规范与细节以本文为准。
- 模板文件（`README_template.md`、`SOLUTION_template.md`）变更时，需同步更新已有场景。
- `meta.yaml` 字段结构变更时，需同步更新所有已有场景的 `meta.yaml`。
