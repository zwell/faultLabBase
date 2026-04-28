# [场景标题] <!-- 例：Kafka 消费者 Rebalance 风暴 -->

> **难度**：⭐⭐☆☆☆ &nbsp;|&nbsp; **技术栈**：Kafka 2.x / Docker &nbsp;|&nbsp; **预计时长**：30–45 分钟  
> **前置知识**：Consumer Group 基本概念、`kafka-consumer-groups.sh` 基本用法  
> **故障显现时间窗口**：inject 后约 **xx时间** 可观察到现象  
> **参数干预**：否 <!-- 若修改了关键参数（如 max.poll.interval.ms），改为"是，见下方说明" -->

---

## 环境要求

- **Docker**：>= 24.0（`docker compose` 命令，非旧版 `docker-compose`）
- **可用内存**：至少 **xx GB**（本场景资源等级：🔴 重量 / 🟡 中量 / 🟢 轻量）

---

## 你会遇到什么

<!--
  用 1–3 句话描述用户"看到"的现象，不涉及原因。
  写出足够让人产生好奇心的细节，但不剧透根因。
  示例：
-->

生产者持续写入，消费者却频繁报 `org.apache.kafka.clients.consumer.CommitFailedException`，
消费延迟（Lag）居高不下，数据始终积压无法追上。Grafana 面板显示 consumer group
每隔约 30 秒就完成一次完整的 rebalance，看起来像在"空转"。

---

## 快速开始

### 1. 启动环境

```bash
# 在项目根目录执行
./cli/faultlab.sh start
```

> 等待所有容器健康（约 30–60 秒），看到 `✅ Environment ready` 即可。

### 2. 注入故障

```bash
./cli/faultlab.sh inject
```

注入完成后，终端会打印一段摘要，例如：

```
=== FaultLab Inject Summary ===
scenario       : kafka-001
lag_before     : 0
lag_after      : 12400
affected_component : consumer-group/my-group
inject_param   : sleep 35s per batch
================================
```

> ⚠️ 摘要本身不是答案，它只描述**当前状态**，帮助你确认故障已生效。

---

## 观察与排查

以下命令帮助你收集线索。没有固定顺序，根据你的判断决定先看什么。

### 查看消费延迟（Lag）

```bash
docker exec kafka001-kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group my-group
```

### 查看消费者日志

```bash
docker logs kafka001-consumer --tail 100 -f
```

### 查看 Kafka Broker 日志

```bash
docker logs kafka001-broker --tail 200 | grep -i rebalance
```

### 检查 Consumer Group 成员

```bash
docker exec kafka001-kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group my-group --members --verbose
```

<!--
  按需增减命令。每条命令后可附一句说明，描述"这个命令能看到什么"，
  但不要说"你会看到 XXX，那说明根因是 YYY"。
-->

---

## 分析你的发现

收集完线索后，尝试回答以下几个问题：

1. Rebalance 的触发频率是否异常？触发原因是什么？
2. 消费者在 rebalance 期间做了什么？有没有异常耗时操作？
3. 有没有哪个配置参数可能与此现象直接相关？

---

## 提交排查结论

当你有了判断，运行：

```bash
./cli/faultlab.sh verify
```

你将进入一段交互，向 AI 描述你认为的根因和解决方案。AI 会根据你的描述给出引导或评分。

> 💡 verify 会读取你在 `.env` 中配置的 API Key。如果尚未配置，请先参考「环境要求」章节。

---

## 清理环境

```bash
./cli/faultlab.sh clean
```

---

## 参考资料

- [Kafka Consumer Group 官方文档](https://kafka.apache.org/documentation/#consumerconfigs)
- [max.poll.interval.ms 参数说明](https://kafka.apache.org/documentation/#max.poll.interval.ms)
- <!-- 其他相关链接 -->
