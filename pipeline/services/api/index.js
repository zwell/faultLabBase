const http = require("http");
const { Pool } = require("pg");
const Redis = require("ioredis");

const PORT = Number(process.env.PORT || 3000);
const PG_HOST = process.env.PG_HOST || "pipeline-postgres";
const PG_PORT = Number(process.env.PG_PORT || 5432);
const PG_USER = process.env.PG_USER || "pipeline";
const PG_PASSWORD = process.env.PG_PASSWORD || "pipeline";
const PG_DATABASE = process.env.PG_DATABASE || "pipeline";
const REDIS_HOST = process.env.REDIS_HOST || "pipeline-redis";
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const QUEUE_KEY = process.env.JOBS_QUEUE_KEY || "jobs:queue";

const pool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
  max: Number(process.env.PG_POOL_MAX || 10),
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

function logRequest(method, path, status, tookMs, errMsg) {
  if (errMsg) {
    process.stdout.write(
      `[api] ${nowIso()} ${method} ${path} ${status} ${tookMs}ms ERROR: ${errMsg}\n`
    );
    return;
  }
  process.stdout.write(`[api] ${nowIso()} ${method} ${path} ${status} ${tookMs}ms\n`);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 256 * 1024) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

async function readInjectFlags() {
  const fail503 = await redis.get("faultlab:inject:api_enqueue_503");
  if (fail503 === "1") {
    return { fail503: true, sleepMs: 0 };
  }
  const sleepRaw = await redis.get("faultlab:inject:api_sleep_ms");
  const sleepMs = sleepRaw != null ? Number(sleepRaw) : 0;
  return { fail503: false, sleepMs: Number.isFinite(sleepMs) && sleepMs > 0 ? sleepMs : 0 };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function handlePostJobs(res, started) {
  const flags = await readInjectFlags();
  if (flags.fail503) {
    const took = Date.now() - started;
    logRequest("POST", "/jobs", 503, took, "injected_enqueue_reject");
    sendJson(res, 503, { error: "service_unavailable" });
    return;
  }
  if (flags.sleepMs > 0) {
    await sleep(flags.sleepMs);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      "INSERT INTO jobs (status, payload) VALUES ('pending', $1) RETURNING id",
      [JSON.stringify({ kind: "report" })]
    );
    const id = ins.rows[0].id;
    await redis.lpush(QUEUE_KEY, String(id));
    await client.query("COMMIT");
    const took = Date.now() - started;
    logRequest("POST", "/jobs", 201, took);
    sendJson(res, 201, { id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const took = Date.now() - started;
    logRequest("POST", "/jobs", 500, took, err.message);
    sendJson(res, 500, { error: "enqueue_failed" });
  } finally {
    client.release();
  }
}

async function handleGetJob(res, idStr, started) {
  const id = Number(idStr);
  if (!Number.isFinite(id) || id < 1) {
    const took = Date.now() - started;
    logRequest("GET", `/jobs/${idStr}`, 400, took);
    sendJson(res, 400, { error: "invalid_id" });
    return;
  }
  try {
    const r = await pool.query("SELECT id, status, created_at, updated_at FROM jobs WHERE id = $1", [id]);
    if (r.rowCount === 0) {
      const took = Date.now() - started;
      logRequest("GET", `/jobs/${id}`, 404, took);
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    const row = r.rows[0];
    const took = Date.now() - started;
    logRequest("GET", `/jobs/${id}`, 200, took);
    sendJson(res, 200, {
      id: row.id,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at
    });
  } catch (err) {
    const took = Date.now() - started;
    logRequest("GET", `/jobs/${id}`, 500, took, err.message);
    sendJson(res, 500, { error: "query_failed" });
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    try {
      await pool.query("SELECT 1");
      await redis.ping();
      const took = Date.now() - started;
      logRequest("GET", "/health", 200, took);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
    } catch (err) {
      const took = Date.now() - started;
      logRequest("GET", "/health", 503, took, err.message);
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("unready");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/jobs") {
    await handlePostJobs(res, started);
    return;
  }

  const jobMatch = url.pathname.match(/^\/jobs\/(\d+)$/);
  if (req.method === "GET" && jobMatch) {
    await handleGetJob(res, jobMatch[1], started);
    return;
  }

  const took = Date.now() - started;
  logRequest(req.method || "GET", url.pathname, 404, took);
  sendJson(res, 404, { error: "not_found" });
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`[api] listening on ${PORT}\n`);
});
