const { Kafka } = require("kafkajs");

const KAFKA_BROKER = process.env.KAFKA_BROKER || "basecamp-kafka:9092";
const TOPIC = "order.created";
const GROUP_ID = "faultlab-consumer";
const SUBSCRIBE_RETRIES = 20;
const SUBSCRIBE_BACKOFF_MS = 1500;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLag(admin, topic, partition, offset) {
  try {
    const topicOffsets = await admin.fetchTopicOffsets(topic);
    const part = topicOffsets.find((p) => p.partition === partition);
    if (!part) {
      return 0;
    }
    const high = Number(part.high);
    const current = Number(offset);
    const lag = high - (current + 1);
    return lag > 0 ? lag : 0;
  } catch (_err) {
    return -1;
  }
}

async function run() {
  const kafka = new Kafka({
    clientId: "faultlab-consumer",
    brokers: [KAFKA_BROKER],
  });

  const consumer = kafka.consumer({ groupId: GROUP_ID });
  const admin = kafka.admin();

  try {
    await admin.connect();
    await consumer.connect();
    process.stdout.write(`[consumer] ${nowIso()} Kafka ready\n`);
  } catch (err) {
    process.stdout.write(`[consumer] ${nowIso()} Kafka connect failed ERROR: ${err.message}\n`);
    throw err;
  }

  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  await admin.createTopics({
    waitForLeaders: true,
    topics: [{ topic: TOPIC, numPartitions: 3, replicationFactor: 1 }],
  });

  let started = false;
  let lastErr = null;
  for (let i = 0; i < SUBSCRIBE_RETRIES; i += 1) {
    try {
      await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
      await consumer.run({
        autoCommit: true,
        eachMessage: async ({ topic, partition, message }) => {
          const start = Date.now();
          const offset = Number(message.offset);
          try {
            await sleep(100);
            const lag = await getLag(admin, topic, partition, offset);
            const took = Date.now() - start;
            process.stdout.write(
              `[consumer] ${nowIso()} consumed ${topic} offset=${offset} lag=${lag} took=${took}ms\n`
            );
          } catch (err) {
            const took = Date.now() - start;
            process.stdout.write(
              `[consumer] ${nowIso()} consume failed offset=${offset} took=${took}ms ERROR: ${err.message}\n`
            );
          }
        },
      });
      started = true;
      break;
    } catch (err) {
      lastErr = err;
      process.stdout.write(
        `[consumer] ${nowIso()} subscribe retry ${i + 1}/${SUBSCRIBE_RETRIES} ERROR: ${err.message}\n`
      );
      await sleep(SUBSCRIBE_BACKOFF_MS);
    }
  }
  if (!started) {
    throw lastErr || new Error("consumer subscribe failed");
  }
}

run().catch((err) => {
  process.stdout.write(`[consumer] ${nowIso()} fatal ERROR: ${err.message}\n`);
  process.exit(1);
});
