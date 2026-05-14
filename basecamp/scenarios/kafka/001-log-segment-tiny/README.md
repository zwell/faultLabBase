# Kafka-001 订单写入后，下游处理一顿一顿，监控上延迟像锯齿

> **难度**：⭐⭐⭐☆☆ | **技术栈**：Kafka / Docker / Basecamp | **预计时长**：25-45 分钟  
> **前置知识**：Kafka Broker 日志段、`kafka-configs.sh`、基础延迟排查  
> **故障显现时间窗口**：inject 后随流量持续存在（与滚动频率相关）  
> **参数干预**：是（Broker 动态调整 `log.segment.bytes`）

---

## 环境要求

- Docker >= 24（使用 `docker compose`）
- 可用内存建议 >= 2 GB（本场景资源等级：heavy）
- verify 需要配置根目录 `.env` 中的 API Key（见 `.env.example`）

---

## 你会遇到什么

订单事件链路出现锯齿状抖动：吞吐与延迟不稳定，Kafka Broker 侧更容易出现与日志滚动相关的压力信号（需要结合指标与配置交叉验证）。

---

## 快速开始

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/kafka/001-log-segment-tiny

./cli/faultlab.sh start
./cli/faultlab.sh inject
```

---

## 观察与排查

```sh
docker logs basecamp-kafka --since 10m
docker logs basecamp-consumer --since 10m
MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server localhost:9092 \
  --describe --group faultlab-consumer
MSYS_NO_PATHCONV=1 docker exec basecamp-kafka /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server localhost:9092 \
  --entity-type brokers --entity-name 1 \
  --describe | grep -i log.segment.bytes
```

---

## 分析你的发现

1. Broker 侧与日志段/滚动相关的配置是否与现象一致？  
2. 你会如何把「Broker 配置问题」与「客户端慢消费」区分开？  
3. 恢复动作应该落在 Broker 默认值、滚动策略，还是业务侧削峰？

---

## 提交排查结论

```sh
FAULTLAB_PROJECT=basecamp FAULTLAB_SCENARIO=basecamp/scenarios/kafka/001-log-segment-tiny ./cli/faultlab.sh verify
```

---

## 清理环境

```sh
./cli/faultlab.sh clean
```

---

## 参考资料

- https://kafka.apache.org/documentation/#brokerconfigs_log.segment.bytes
