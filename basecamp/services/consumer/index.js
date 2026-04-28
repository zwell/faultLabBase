const { Kafka } = require("kafkajs");

const KAFKA_BROKER = process.env.KAFKA_BROKER || "basecamp-kafka:9092";
const TOPIC = "order.created";
const GROUP_ID = "faultlab-consumer";

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
}

run().catch((err) => {
  process.stdout.write(`[consumer] ${nowIso()} fatal ERROR: ${err.message}\n`);
  process.exit(1);
});
