# Kafka-002 部分下单失败陡增，日志里卡在「写事件」那一步

> **难度**：⭐⭐⭐☆☆ | **技术栈**：Kafka / Docker / Basecamp | **预计时长**：25-45 分钟  
> **前置知识**：Kafka 消息大小、`kafka-configs.sh`、生产者错误日志  
> **故障显现时间窗口**：inject 后约数秒起（取决于下单流量）  
> **参数干预**：是（topic `max.message.bytes` 被人为调低）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存建议 >= 2 GB（本场景资源等级：heavy）
- verify 需要配置根目录 `.env` 中的 API Key（见 `.env.example`）

---

## 你会遇到什么

部分下单失败或重试陡增；API 日志出现与 Kafka 发送相关的错误，且与「消息体过大」类错误关键词相关。

---

## 快速开始

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/kafka/002-message-max-bytes

./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```sh
docker logs basecamp-api --since 10m
MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server localhost:9092 \
  --entity-type topics --entity-name order.created \
  --describe | grep -i max.message.bytes
MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server localhost:9092 \
  --describe --topic order.created
```

---

## 分析你的发现

1. topic 级消息上限与失败日志是否能闭环？  
2. 你会如何区分「序列化变大」与「Broker/Topic 限额变严」？  
3. 恢复动作应该落在 Broker、Topic 还是应用侧？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/kafka/002-message-max-bytes ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
./cli/faultlab.sh clean
```

---

## 参考资料

- https://kafka.apache.org/documentation/#topicconfigs_max.message.bytes
