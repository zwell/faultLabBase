# SOLUTION — [场景标题]

<!--
  本文件供以下用途：
    1. verify 模块（LLM）读取，与学习者的描述做对比、给出引导
    2. 学习者完成排查后自行核对
  
  编写规范：
    - 每个 section 的标题保持不变（verify 通过标题定位内容）
    - 内容尽量完整、有依据，但语言可以简洁
    - 不要在 README.md 中引用或提及本文件的具体内容
-->

---

## 根因（Root Cause）

<!--
  1–3 句话，精确描述技术层面的根本原因。
  应能被一个了解该技术的工程师一眼读懂。
  
  若 meta.yaml 中 parameter_intervention: true，必须在此说明：
    - 哪个参数被修改、改为什么值
    - 该参数的生产默认值是多少
    - 这种配置在真实生产中是否常见，以及为何会出现
  示例：
-->

消费者的单次 `poll()` 处理批次耗时超过了 `max.poll.interval.ms`（默认 5 分钟）的配置值。
Kafka Broker 认为该消费者已失活，将其踢出 Consumer Group 并触发 Rebalance。
由于处理逻辑中存在阻塞调用（模拟慢处理），每次 Rebalance 后消费者重新加入又会再次触发，形成循环。

<!-- 若存在参数干预，在此补充，示例：
**参数干预说明**：本场景将 `max.poll.interval.ms` 从默认 300000ms 调低至 30000ms 以缩短实验等待时间。
生产中此参数通常保持默认值；当业务处理逻辑确实耗时较长时，有团队会将其调高，但调低的情况极少见。
-->

---

## 关键证据（Key Evidence）

<!--
  按三类分层列出可观测信号，便于 verify LLM 稳定判分。
  每条包含：证据描述 + 具体值或关键字 + 获取方式。
-->

**日志证据**

| 证据 | 预期关键字 / 内容 | 获取方式 |
|------|-----------------|---------|
| Consumer 异常日志 | `CommitFailedException` 或 `Rebalancing` | `docker logs kafka001-consumer` |
| Consumer 处理耗时 | 单次处理时间 > 30s 的日志行 | `docker logs kafka001-consumer` |

**指标证据**

| 证据 | 预期观测值 | 获取方式 |
|------|-----------|---------|
| Rebalance 频率 | 约每 30 秒一次 | `kafka-consumer-groups.sh --describe` |
| Consumer Group 状态 | `PreparingRebalance` 或 `CompletingRebalance` | `kafka-consumer-groups.sh --describe` |
| 消费延迟（Lag）趋势 | 单调递增，无下降 | `kafka-consumer-groups.sh --describe` |

**配置证据**

| 证据 | 预期值 | 获取方式 |
|------|-------|---------|
| `max.poll.interval.ms` | 与 Rebalance 周期吻合 | Consumer 启动日志 或 `kafka-configs.sh` |

---

## 解决方案（Solution）

<!--
  分步骤说明如何修复问题。
  每个方案单独一个子标题，并标注推荐程度。
-->

### 方案 A：调大 `max.poll.interval.ms`（临时缓解，⭐ 推荐优先评估）

```properties
# consumer.properties
max.poll.interval.ms=300000   # 根据实际处理耗时上限设置，默认 300000（5 分钟）
```

> 适用场景：处理逻辑本身是合理的，只是偶尔耗时较长。
> 风险：掩盖了真正的性能问题，且 Kafka 感知消费者失活的延迟增大。

### 方案 B：减小 `max.poll.records`，降低单次处理量（推荐）

```properties
# consumer.properties
max.poll.records=50   # 默认 500，降低后每批处理量减少，耗时可控
```

> 适用场景：批次过大导致单次处理时间不可预测。
> 效果：在不改动业务逻辑的前提下，降低触发超时的概率。

### 方案 C：将慢操作移出 poll 循环（根本解决）

将耗时的 I/O 或外部调用（数据库写入、HTTP 请求等）改为异步处理，
确保 `poll()` → 处理 → `commitSync()` 的整个循环在 `max.poll.interval.ms` 内完成。

```python
# 伪代码示意
while True:
    records = consumer.poll(timeout_ms=1000)
    for record in records:
        queue.put(record)          # 交给异步 worker，不阻塞主循环
    consumer.commit()
```

---

## 评分要点（Scoring Rubric）

<!--
  供 verify LLM 使用。字段名和格式保持稳定，verify 模块依赖此结构。
  reality_check 用于区分"背了机制"和"真正理解了场景"。
-->

```yaml
full_credit:
  - 明确说出 max.poll.interval.ms 超时是触发 Rebalance 的直接原因
  - 提到消费者处理耗时过长（慢消费/阻塞）
  - 给出至少一种有效的解决方向（调参 或 异步化）
  - reality_check: 能说明触发是基于默认参数（或说明参数被人为修改）

partial_credit:
  - 只说"Rebalance 太频繁"但未指出超时机制
  - 只提到 Lag 增大，未追溯到消费者行为
  - 解决方案方向正确但参数名称有误

no_credit:
  - 将根因归结为 Broker 配置或网络问题
  - 未提及 Consumer Group 或 Rebalance 机制
```

---

## 实现说明（Implementation Notes）

<!--
  必填。说明本实验实现与真实生产的差异，帮助学习者建立正确预期。
  至少包含：
    1. 故障如何模拟（用了什么手段代替真实触发条件）
    2. 环境简化了哪些生产要素（单节点、无鉴权、无监控等）
    3. 学习者可以从本场景迁移到真实生产的核心结论
-->

- 本场景使用 Kafka 官方 `console-consumer` 模拟慢消费，通过 `sleep` 注入延迟。真实生产中慢消费通常来自数据库写入、HTTP 调用等 I/O 阻塞，行为模式相同但触发原因更多样。
- 单 Broker 单 Partition 环境，省略了多副本的 Leader 选举过程，不影响本场景的核心故障路径。
- 无鉴权、无 TLS，与生产环境有差异，但不影响故障机制的学习。
- <!-- 如有其他偏差，继续补充 -->

---

## 延伸思考（Further Reading）

<!--
  可选。给已掌握根因的学习者提供更深的探索方向。
-->

- **为什么 Kafka 选择 poll-interval 而非 heartbeat 来检测消费者活性？**  
  → 参考：[KIP-62](https://cwiki.apache.org/confluence/display/KAFKA/KIP-62%3A+Allow+consumer+to+send+heartbeats+from+a+background+thread)

- **session.timeout.ms 与 max.poll.interval.ms 有什么区别？**  
  → 前者由 heartbeat 线程维持，后者由 poll 调用维持，两者独立计时。

- **Cooperative Rebalance（增量再平衡）如何缓解此问题？**  
  → 参考：[Kafka 2.4 Cooperative Rebalancing](https://www.confluent.io/blog/cooperative-rebalancing-in-kafka-streams-consumer-ksqldb/)

- 官方配置参考：  
  https://kafka.apache.org/documentation/#consumerconfigs
