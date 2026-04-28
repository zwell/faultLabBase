# FaultLab Basecamp — Claude Code 启动 Prompt

以下是分阶段给 Claude Code 的 prompt，按顺序执行，每个阶段验证通过后再进行下一个。

---

## Phase 1｜底座基础结构

```
请先完整阅读项目根目录的 CLAUDE.md 和 docs/CONTRIBUTING.md，然后执行以下任务：

在 basecamp/ 目录下创建底座的基础结构，包含：

1. basecamp/docker-compose.yml
   - 包含 7 个容器：basecamp-mysql、basecamp-redis、basecamp-kafka、
     basecamp-api、basecamp-consumer、basecamp-nginx、basecamp-loader
   - 所有容器在 basecamp-net 网络
   - 镜像版本固定，支持环境变量覆盖
   - 健康检查完整，依赖链正确（mysql/redis/kafka 就绪后 api 才启动）
   - 端口默认不暴露宿主机
   - 容器内变量用 $$ 转义

2. basecamp/mysql/init.sql
   - 按 CLAUDE.md 中的数据模型建表
   - 插入种子数据：100 个用户、100 个商品（库存各 1000）

3. basecamp/nginx/nginx.conf
   - 反向代理到 basecamp-api:3000
   - upstream 配置 keepalive

完成后执行 docker compose -f basecamp/docker-compose.yml up -d，
确认所有容器健康后报告结果。
```

---

## Phase 2｜流量生成器

```
阅读 CLAUDE.md 后执行：

创建 basecamp/services/loader/run.sh：
- 纯 sh 语法，不用 bash only 特性
- 持续向 http://basecamp-nginx 发请求
- 流量比例：60% GET /products/:id，30% POST /orders，10% GET /orders/:id
- 商品 ID 随机 1-100，用户 ID 随机 1-100，订单 ID 随机 1-500
- 每次请求后 sleep 0.1~0.5s（用 awk rand() 生成）
- 打印每次请求的结果：方法、路径、HTTP 状态码、耗时
- 单次失败后继续，不退出

格式示例：
[loader] GET /products/42 200 8ms
[loader] POST /orders 201 34ms
[loader] GET /products/99 500 3001ms ERROR

在 docker-compose.yml 中确认 loader 容器已正确配置后，
运行 docker logs basecamp-loader -f 观察 30 秒，确认请求在持续发出。
```

---

## Phase 3｜API 服务

```
阅读 CLAUDE.md 后执行：

创建 basecamp/services/api/index.js 和 package.json：

要求：
- 用 Node.js 原生 http 模块，不引入任何框架
- 依赖：mysql2、ioredis、kafkajs（package.json 中固定版本）
- 实现四个路由（见 CLAUDE.md 服务实现规范）
- 日志每行一条，含时间戳、方法、路径、状态码、耗时
- 错误时日志末尾加 ERROR: <message>
- 启动时打印连接状态（MySQL/Redis/Kafka 是否就绪）

连接配置从环境变量读取：
- MYSQL_HOST=basecamp-mysql, MYSQL_PORT=3306, MYSQL_USER=root, MYSQL_PASSWORD=root, MYSQL_DB=faultlab
- REDIS_HOST=basecamp-redis, REDIS_PORT=6379
- KAFKA_BROKER=basecamp-kafka:9092

完成后重启 basecamp-api 容器，用 loader 打流量 60 秒，
检查 docker logs basecamp-api 确认请求日志正常输出。
```

---

## Phase 4｜Consumer 服务

```
阅读 CLAUDE.md 后执行：

创建 basecamp/services/consumer/index.js：

要求：
- 消费 Kafka topic: order.created，consumer group: faultlab-consumer
- 每条消息 sleep 100ms 模拟处理耗时（积分发放）
- 日志格式：[consumer] <timestamp> consumed order.created offset=<n> lag=<n> took=<n>ms
- 启动时打印 Kafka 连接状态
- 消费失败打印错误但继续运行

完成后重启 basecamp-consumer，
下几个订单（POST /orders），
确认 consumer 日志中出现对应的消费记录。
```

---

## Phase 5｜第一个场景（mysql-001）

```
阅读 CLAUDE.md 和 docs/CONTRIBUTING.md 后执行：

创建第一个基于底座的场景 scenarios/mysql/001-connection-pool/，
场景描述：MySQL 连接池打满，支付回调接口超时。

需要创建以下文件：

1. meta.yaml
   - id: mysql-001, tech: mysql, difficulty: 3
   - requires_basecamp: true, business_context: payment
   - resource_level: heavy, parameter_intervention: true

2. inject.sh
   - 先检查 basecamp-mysql 容器是否运行
   - 执行：SET GLOBAL max_connections = 10
   - 等待 5 秒让 loader 流量把连接耗尽
   - 输出标准摘要（含注入前后的 max_connections 值）

3. scenario.md（业务剧本，不含技术根因）
   内容大致为：
   「支付团队收到告警：支付回调接口 P99 延迟从 80ms 升至 8s，
   部分用户支付后订单长时间停留在"处理中"。
   时间：大促开始后 15 分钟。你是今晚的 on-call。」

4. README.md
   - 按 CONTRIBUTING.md 模板编写
   - 排查命令列表（不含根因提示）
   - 不出现任何根因线索

5. SOLUTION.md
   - 五个必须 section 齐全
   - 评分要点为合法 YAML

6. test.sh
   - 注入后等待 Threads_connected >= 8 则 PASS
   - 超时 30s 则 FAIL

完成后运行：
  docker compose -f basecamp/docker-compose.yml up -d
  sh scenarios/mysql/001-connection-pool/inject.sh
  sh scenarios/mysql/001-connection-pool/test.sh

报告三个命令的输出结果。
```

---

## 使用说明

- 每个 Phase 单独给 Claude Code，不要一次性全部发送
- 每个 Phase 结束后人工验证（看日志、检查容器状态）再进行下一个
- 如果某步失败，把错误日志贴给 Claude Code 让它修复，不要跳过
- Phase 1 是关键，底座跑不起来后面全白搭，务必确认所有容器 healthy
