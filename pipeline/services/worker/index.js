const { Pool } = require("pg");
const Redis = require("ioredis");

const PG_HOST = process.env.PG_HOST || "pipeline-postgres";
const PG_PORT = Number(process.env.PG_PORT || 5432);
const PG_USER = process.env.PG_USER || "pipeline";
const PG_PASSWORD = process.env.PG_PASSWORD || "pipeline";
const PG_DATABASE = process.env.PG_DATABASE || "pipeline";
const REDIS_HOST = process.env.REDIS_HOST || "pipeline-redis";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QUEUE_KEY = process.env.JOBS_QUEUE_KEY || "jobs:queue";
const BASE_DELAY_MS = Number(process.env.PROCESS_DELAY_MS || 50);
const INJECT_DELAY_KEY = "faultlab:inject:delay_ms";

const pool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
  max: Number(process.env.PG_POOL_MAX || 5),
  idleTimeoutMillis: 30_000
});

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  maxRetriesPerRequest: 2
});

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  for (;;) {
    let jobId;
    try {
      const popped = await redis.brpop(QUEUE_KEY, 3);
      if (!popped) continue;
      jobId = popped[1];
      const queueLag = await redis.llen(QUEUE_KEY);
      const injectExtra = await redis.get(INJECT_DELAY_KEY);
      const extra = injectExtra != null ? Number(injectExtra) : 0;
      const processDelay = BASE_DELAY_MS + (Number.isFinite(extra) ? extra : 0);

      const t0 = Date.now();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE jobs SET status = 'processing', updated_at = NOW() WHERE id = $1", [jobId]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }

      if (processDelay > 0) {
        await sleep(processDelay);
      }

      const client2 = await pool.connect();
      try {
        await client2.query("UPDATE jobs SET status = 'done', updated_at = NOW() WHERE id = $1", [jobId]);
      } finally {
        client2.release();
      }

      const took = Date.now() - t0;
      process.stdout.write(
        `[worker] ${nowIso()} processed job id=${jobId} queue_lag=${queueLag} took=${took}ms\n`
      );
    } catch (err) {
      process.stderr.write(`[worker] ${nowIso()} error job=${jobId || "?"} ${err.message}\n`);
      await sleep(500);
    }
  }
}

loop().catch((err) => {
  process.stderr.write(`[worker] fatal ${err.message}\n`);
  process.exit(1);
});
