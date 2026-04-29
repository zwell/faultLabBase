const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { exec, spawn } = require("child_process");
const yaml = require("js-yaml");
const WebSocket = require("ws");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const REPO_ROOT = path.resolve(__dirname, "..");
const PROJECT_FILE = path.join(REPO_ROOT, "project.yaml");
const PUBLIC_DIR = path.join(__dirname, "public");
const SCENARIO_STATE_FILE = path.join(__dirname, ".scenario-fault-state.json");

async function readYamlFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return yaml.load(raw);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function safeRelativePath(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).replaceAll(path.sep, "/");
}

async function loadProjects() {
  const parsed = await readYamlFile(PROJECT_FILE);
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  return projects;
}

async function walkScenarioDirs(rootDir) {
  const result = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const hasMeta = entries.some((entry) => entry.isFile() && entry.name === "meta.yaml");
    if (hasMeta) {
      result.push(currentDir);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(path.join(currentDir, entry.name));
      }
    }
  }

  await walk(rootDir);
  return result;
}

async function loadScenarioFromDir(scenarioDir) {
  const metaPath = path.join(scenarioDir, "meta.yaml");
  const scenarioDocPath = path.join(scenarioDir, "scenario.md");
  const readmePath = path.join(scenarioDir, "README.md");

  const meta = await readYamlFile(metaPath);
  let scenarioBrief = "";
  let troubleshootingGuide = "";

  if (await pathExists(scenarioDocPath)) {
    scenarioBrief = await fs.readFile(scenarioDocPath, "utf8");
  }
  if (await pathExists(readmePath)) {
    troubleshootingGuide = await fs.readFile(readmePath, "utf8");
  }

  return {
    dir: safeRelativePath(scenarioDir),
    meta,
    scenario_brief: scenarioBrief,
    troubleshooting_guide: troubleshootingGuide
  };
}

async function loadProjectScenarios(project) {
  if (!project || typeof project.scenario_path !== "string" || project.scenario_path.trim() === "") {
    return [];
  }

  const absoluteScenarioPath = path.resolve(REPO_ROOT, project.scenario_path);
  if (!(await pathExists(absoluteScenarioPath))) {
    return [];
  }

  const scenarioDirs = await walkScenarioDirs(absoluteScenarioPath);
  const scenarios = [];
  for (const scenarioDir of scenarioDirs) {
    scenarios.push(await loadScenarioFromDir(scenarioDir));
  }
  return scenarios;
}

function resolveScenarioScriptPath(scenario, scriptName) {
  const relDir = scenario?.dir;
  if (!relDir) return null;
  return path.join(REPO_ROOT, relDir, scriptName);
}

async function runScenarioAction(project, scenario, action) {
  const basecampId = project?.id || "";
  const scriptName = action === "inject" ? "inject.sh" : "";
  if (!scriptName) {
    const err = new Error("unsupported_action");
    err.code = "unsupported_action";
    throw err;
  }
  const scriptAbs = resolveScenarioScriptPath(scenario, scriptName);
  if (!scriptAbs || !(await pathExists(scriptAbs))) {
    const err = new Error("scenario_script_not_found");
    err.code = "scenario_script_not_found";
    throw err;
  }
  const scriptRel = safeRelativePath(scriptAbs);
  const cmd = `sh ${JSON.stringify(scriptRel)}`;
  broadcastToHostTerminals(basecampId, `\r\n$ ${cmd}\r\n`);
  await spawnShellStreaming(cmd, {
    cwd: REPO_ROOT,
    timeoutMs: 5 * 60 * 1000,
    onChunk: (chunk) => broadcastToHostTerminals(basecampId, chunk)
  });
}

function execCommand(command, options) {
  return new Promise((resolve, reject) => {
    exec(
      command,
      { ...options, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function getDockerRunningNames() {
  try {
    const { stdout } = await execCommand("docker ps --format '{{.Names}}'", { cwd: REPO_ROOT });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function rankResourceLevel(level) {
  const order = { light: 1, medium: 2, heavy: 3 };
  return order[level] || 0;
}

const metricsStore = new Map(); // basecampId -> state

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 0) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function ensureMetricsState(basecampId) {
  if (!metricsStore.has(basecampId)) {
    metricsStore.set(basecampId, {
      tick: 0,
      orderPoints: [],
      consumerPoints: [],
      storagePoints: []
    });
  }
  return metricsStore.get(basecampId);
}

function getPhaseByTick(tick) {
  const segment = tick % 60;
  if (segment < 20) return "normal";
  if (segment < 40) return "warn";
  return "critical";
}

function parseInfoValue(infoText, key) {
  const line = String(infoText || "")
    .split("\n")
    .find((item) => item.startsWith(`${key}:`));
  if (!line) return NaN;
  const raw = line.slice(key.length + 1).trim();
  return Number(raw);
}

async function collectRuntimeStorageMetrics() {
  try {
    const mysqlConnOut = await execCommand(
      "docker exec basecamp-mysql mysql -u root -proot -N -e \"SHOW STATUS LIKE 'Threads_connected'\"",
      { cwd: REPO_ROOT, timeout: 5 * 1000 }
    );
    const mysqlMaxOut = await execCommand(
      "docker exec basecamp-mysql mysql -u root -proot -N -e \"SHOW VARIABLES LIKE 'max_connections'\"",
      { cwd: REPO_ROOT, timeout: 5 * 1000 }
    );
    const mysqlActiveOut = await execCommand(
      "docker exec basecamp-mysql sh -lc \"mysql -u root -proot -N -e \\\"SHOW FULL PROCESSLIST\\\" | wc -l\"",
      { cwd: REPO_ROOT, timeout: 5 * 1000 }
    );
    const redisMemoryOut = await execCommand("docker exec basecamp-redis redis-cli --raw INFO memory", {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });
    const redisStatsOut = await execCommand("docker exec basecamp-redis redis-cli --raw INFO stats", {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });
    const redisDbsizeOut = await execCommand("docker exec basecamp-redis redis-cli --raw DBSIZE", {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });

    const mysqlConnections = Number(String(mysqlConnOut.stdout).trim().split(/\s+/).pop());
    const mysqlConnectionsMax = Number(String(mysqlMaxOut.stdout).trim().split(/\s+/).pop());
    const mysqlActiveQueries = Number(String(mysqlActiveOut.stdout).trim());

    const usedMemoryBytes = parseInfoValue(redisMemoryOut.stdout, "used_memory");
    const maxMemoryBytes = parseInfoValue(redisMemoryOut.stdout, "maxmemory");
    const totalSystemMemoryBytes = parseInfoValue(redisMemoryOut.stdout, "total_system_memory");
    const hits = parseInfoValue(redisStatsOut.stdout, "keyspace_hits");
    const misses = parseInfoValue(redisStatsOut.stdout, "keyspace_misses");
    const redisKeyCount = Number(String(redisDbsizeOut.stdout).trim());

    const safeMaxBytes = Number.isFinite(maxMemoryBytes) && maxMemoryBytes > 0 ? maxMemoryBytes : totalSystemMemoryBytes;
    const totalLookups = (Number.isFinite(hits) ? hits : 0) + (Number.isFinite(misses) ? misses : 0);
    const redisHitRate = totalLookups > 0 ? (Number.isFinite(hits) ? hits : 0) / totalLookups : NaN;

    return {
      mysql_connections: Number.isFinite(mysqlConnections) ? mysqlConnections : NaN,
      mysql_connections_max: Number.isFinite(mysqlConnectionsMax) ? mysqlConnectionsMax : NaN,
      mysql_active_queries: Number.isFinite(mysqlActiveQueries) ? mysqlActiveQueries : NaN,
      redis_mem_used_mb: Number.isFinite(usedMemoryBytes) ? round(usedMemoryBytes / (1024 * 1024), 2) : NaN,
      redis_mem_max_mb: Number.isFinite(safeMaxBytes) ? round(safeMaxBytes / (1024 * 1024), 2) : NaN,
      redis_hit_rate: Number.isFinite(redisHitRate) ? round(redisHitRate, 4) : NaN,
      redis_key_count: Number.isFinite(redisKeyCount) ? redisKeyCount : NaN
    };
  } catch {
    return null;
  }
}

function computePercentile(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function collectRuntimeOrderMetrics() {
  try {
    const { stdout } = await execCommand("docker logs --since 2m basecamp-api 2>&1", {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });
    const now = Date.now();
    const lines = String(stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("[api]") && /\s(GET|POST)\s+\/\S+\s+\d+\s+\d+ms/.test(line));

    const lastMinuteEntries = [];
    for (const line of lines) {
      // Example: [api] 2024-... GET /orders 201 123ms
      const match = line.match(/^\[api\]\s+(\S+)\s+(GET|POST)\s+(\S+)\s+(\d+)\s+(\d+)ms/);
      if (!match) continue;
      const ts = Date.parse(match[1]);
      if (!Number.isFinite(ts)) continue;
      if (now - ts > 60 * 1000) continue;
      lastMinuteEntries.push({
        ts,
        path: match[3],
        status: Number(match[4]),
        tookMs: Number(match[5])
      });
    }

    const chainEntries = lastMinuteEntries.filter((item) => item.path.startsWith("/orders"));
    const total = chainEntries.length;
    if (total === 0) {
      return {
        requests_per_min: 0,
        p99_ms: 0,
        error_rate: 0,
        p95_ms: 0,
        p50_ms: 0,
        status_2xx: 0,
        status_4xx: 0,
        status_5xx: 0
      };
    }
    const latencies = chainEntries.map((item) => item.tookMs).filter((n) => Number.isFinite(n));
    const s2 = chainEntries.filter((item) => item.status >= 200 && item.status < 300).length;
    const s4 = chainEntries.filter((item) => item.status >= 400 && item.status < 500).length;
    const s5 = chainEntries.filter((item) => item.status >= 500).length;
    const errors = s4 + s5;
    return {
      requests_per_min: total,
      p99_ms: round(computePercentile(latencies, 99) || 0),
      error_rate: round(errors / total, 4),
      p95_ms: round(computePercentile(latencies, 95) || 0),
      p50_ms: round(computePercentile(latencies, 50) || 0),
      status_2xx: s2,
      status_4xx: s4,
      status_5xx: s5
    };
  } catch {
    return null;
  }
}

async function collectRuntimeConsumerMetrics() {
  try {
    const { stdout } = await execCommand("docker logs --since 2m basecamp-consumer 2>&1", {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });
    const now = Date.now();
    const rows = [];
    for (const line of String(stdout).split("\n")) {
      // Example: [consumer] ts consumed order.created offset=42 lag=0 took=103ms
      const match = line.match(
        /^\[consumer\]\s+(\S+)\s+consumed\s+\S+\s+offset=(\d+)\s+lag=(-?\d+)\s+took=(\d+)ms/
      );
      if (!match) continue;
      const ts = Date.parse(match[1]);
      if (!Number.isFinite(ts)) continue;
      if (now - ts > 60 * 1000) continue;
      rows.push({
        ts,
        offset: Number(match[2]),
        lag: Math.max(0, Number(match[3])),
        took_ms: Number(match[4])
      });
    }

    if (rows.length === 0) {
      return { lag: 0, avg_process_ms: 0, offset: 0, took_ms: 0 };
    }
    const latest = rows[rows.length - 1];
    const avg = rows.reduce((sum, item) => sum + item.took_ms, 0) / rows.length;
    return {
      lag: latest.lag,
      avg_process_ms: round(avg),
      offset: latest.offset,
      took_ms: latest.took_ms
    };
  } catch {
    return null;
  }
}

function buildMockMetricsPoint(phase, tick) {
  const wave = Math.sin(tick / 4);

  const orderBase =
    phase === "critical"
      ? { req: 85, p99: 2600, err: 0.19 }
      : phase === "warn"
        ? { req: 58, p99: 900, err: 0.08 }
        : { req: 42, p99: 180, err: 0.01 };
  const consumerBase =
    phase === "critical" ? { lag: 720, avg: 520 } : phase === "warn" ? { lag: 180, avg: 220 } : { lag: 16, avg: 105 };
  const storageBase =
    phase === "critical"
      ? { mysql: 138, mysqlMax: 151, redisUsed: 468, redisMax: 512, redisHit: 0.68, active: 35, keys: 17240 }
      : phase === "warn"
        ? { mysql: 112, mysqlMax: 151, redisUsed: 376, redisMax: 512, redisHit: 0.82, active: 18, keys: 13120 }
        : { mysql: 56, mysqlMax: 151, redisUsed: 242, redisMax: 512, redisHit: 0.94, active: 7, keys: 9800 };

  const requests = clamp(Math.round(orderBase.req + wave * 6 + randomInt(-3, 3)), 0, 99999);
  const errorRate = clamp(orderBase.err + wave * 0.01 + randomInt(-1, 1) * 0.004, 0, 1);
  const p99 = clamp(Math.round(orderBase.p99 + wave * 120 + randomInt(-80, 120)), 20, 20000);
  const p95 = Math.max(10, Math.round(p99 * 0.62));
  const p50 = Math.max(5, Math.round(p99 * 0.28));
  const errors = Math.max(0, Math.round(requests * errorRate));
  const xx5 = Math.max(0, Math.round(errors * 0.7));
  const xx4 = Math.max(0, errors - xx5);
  const xx2 = Math.max(0, requests - errors);

  const lag = clamp(Math.round(consumerBase.lag + wave * 24 + randomInt(-15, 20)), 0, 999999);
  const avgProcessMs = clamp(Math.round(consumerBase.avg + wave * 14 + randomInt(-8, 12)), 1, 10000);
  const offset = tick * 17 + randomInt(1, 10);
  const consumeTook = clamp(Math.round(avgProcessMs + randomInt(-20, 30)), 1, 12000);

  const mysqlConnections = clamp(Math.round(storageBase.mysql + wave * 6 + randomInt(-3, 4)), 0, storageBase.mysqlMax);
  const redisUsedMb = clamp(Math.round(storageBase.redisUsed + wave * 10 + randomInt(-6, 8)), 0, storageBase.redisMax);
  const redisHitRate = clamp(storageBase.redisHit + wave * 0.02 + randomInt(-2, 2) * 0.005, 0, 1);
  const activeQueries = clamp(Math.round(storageBase.active + wave * 2 + randomInt(-1, 2)), 0, 9999);
  const redisKeys = clamp(Math.round(storageBase.keys + wave * 240 + randomInt(-80, 120)), 0, 9999999);

  return {
    order: {
      requests_per_min: requests,
      p99_ms: p99,
      error_rate: round(errorRate, 4),
      p95_ms: p95,
      p50_ms: p50,
      status_2xx: xx2,
      status_4xx: xx4,
      status_5xx: xx5
    },
    consumer: {
      lag,
      avg_process_ms: avgProcessMs,
      offset,
      took_ms: consumeTook
    },
    storage: {
      mysql_connections: mysqlConnections,
      mysql_connections_max: storageBase.mysqlMax,
      redis_mem_used_mb: redisUsedMb,
      redis_mem_max_mb: storageBase.redisMax,
      redis_hit_rate: round(redisHitRate, 4),
      mysql_active_queries: activeQueries,
      redis_key_count: redisKeys
    }
  };
}

function pushBounded(list, item, maxSize = 120) {
  list.push(item);
  while (list.length > maxSize) list.shift();
}

async function collectMetricsSummary(basecampId, isRunning) {
  const state = ensureMetricsState(basecampId);
  state.tick += 1;
  const ts = new Date().toISOString();

  if (!isRunning) {
    const placeholder = {
      order: { requests_per_min: null, p99_ms: null, error_rate: null },
      consumer: { lag: null, avg_process_ms: null },
      storage: {
        mysql_connections: null,
        mysql_connections_max: null,
        redis_mem_used_mb: null,
        redis_mem_max_mb: null,
        redis_hit_rate: null
      },
      collected_at: ts
    };
    return placeholder;
  }

  const phase = getPhaseByTick(state.tick);
  const point = buildMockMetricsPoint(phase, state.tick);
  const runtimeOrder = await collectRuntimeOrderMetrics();
  const runtimeConsumer = await collectRuntimeConsumerMetrics();
  const runtimeStorage = await collectRuntimeStorageMetrics();
  const order = runtimeOrder || point.order;
  const consumer = runtimeConsumer || point.consumer;
  const storage = runtimeStorage || point.storage;

  pushBounded(state.orderPoints, {
    ts,
    requests: order.requests_per_min,
    errors: Math.round(order.requests_per_min * order.error_rate),
    p99_ms: order.p99_ms,
    p95_ms: order.p95_ms,
    p50_ms: order.p50_ms,
    status_2xx: order.status_2xx,
    status_4xx: order.status_4xx,
    status_5xx: order.status_5xx
  });
  pushBounded(state.consumerPoints, {
    ts,
    lag: consumer.lag,
    avg_process_ms: consumer.avg_process_ms,
    offset: consumer.offset,
    took_ms: consumer.took_ms
  });
  pushBounded(state.storagePoints, {
    ts,
    mysql_connections: storage.mysql_connections,
    mysql_connections_max: storage.mysql_connections_max,
    mysql_active_queries: storage.mysql_active_queries,
    redis_mem_used_mb: storage.redis_mem_used_mb,
    redis_mem_max_mb: storage.redis_mem_max_mb,
    redis_hit_rate: storage.redis_hit_rate,
    redis_key_count: storage.redis_key_count
  });

  return {
    order: {
      requests_per_min: order.requests_per_min,
      p99_ms: order.p99_ms,
      error_rate: order.error_rate
    },
    consumer: {
      lag: consumer.lag,
      avg_process_ms: consumer.avg_process_ms
    },
    storage: {
      mysql_connections: storage.mysql_connections,
      mysql_connections_max: storage.mysql_connections_max,
      redis_mem_used_mb: storage.redis_mem_used_mb,
      redis_mem_max_mb: storage.redis_mem_max_mb,
      redis_hit_rate: storage.redis_hit_rate
    },
    collected_at: ts
  };
}

function getMetricsDetail(basecampId, chain, limit, isRunning) {
  const state = ensureMetricsState(basecampId);
  if (!isRunning) return { points: [] };

  const max = clamp(Number(limit) || 40, 1, 120);
  if (chain === "order") {
    return { points: state.orderPoints.slice(-max) };
  }
  if (chain === "consumer") {
    return { points: state.consumerPoints.slice(-max) };
  }
  if (chain === "storage") {
    return { points: state.storagePoints.slice(-max) };
  }
  return { points: [] };
}

async function loadBasecampSummary(project) {
  const scenarios = await loadProjectScenarios(project);
  let resourceLevel = "unknown";
  for (const item of scenarios) {
    const level = item?.meta?.resource_level;
    if (typeof level === "string" && rankResourceLevel(level) > rankResourceLevel(resourceLevel)) {
      resourceLevel = level;
    }
  }

  return {
    scenario_count: scenarios.length,
    resource_level: resourceLevel
  };
}

async function loadBasecamps() {
  const projects = await loadProjects();
  const runningNames = await getDockerRunningNames();

  const basecamps = [];
  for (const project of projects) {
    const summary = await loadBasecampSummary(project);

    let status = "stopped";
    if (runningNames === null) {
      status = "unknown";
    } else if (Array.isArray(project.topology) && project.topology.some((name) => runningNames.includes(name))) {
      status = "running";
    }

    basecamps.push({
      id: project.id,
      name: project.name || project.id,
      intro: project.intro || "",
      status,
      scenario_count: summary.scenario_count,
      resource_level: summary.resource_level,
      startup: project.startup || "",
      purpose: project.purpose || "",
      stack: Array.isArray(project.stack) ? project.stack : [],
      topology: Array.isArray(project.topology) ? project.topology : []
    });
  }

  return basecamps;
}

function extractComposeFileFromStartup(startupCommand) {
  if (typeof startupCommand !== "string") return null;
  const match = startupCommand.match(/docker\s+compose\s+-f\s+([^\s]+)\s+/);
  return match ? match[1] : null;
}

async function runBasecampAction(project, action) {
  const startup = project?.startup || "";
  const composeFile = extractComposeFileFromStartup(startup);
  if (!composeFile) {
    const error = new Error("unsupported_start_command");
    error.code = "unsupported_start_command";
    throw error;
  }

  const composeCmd = (args) => `docker compose -f ${composeFile} ${args}`;
  const stream = (cmd) =>
    spawnShellStreaming(cmd, {
      cwd: REPO_ROOT,
      timeoutMs: 5 * 60 * 1000,
      onChunk: (chunk) => broadcastToHostTerminals(project.id, chunk)
    });

  if (action === "start") {
    broadcastToHostTerminals(project.id, `\r\n$ ${startup}\r\n`);
    await stream(startup);
    return;
  }

  if (action === "stop") {
    const cmd = composeCmd("down");
    broadcastToHostTerminals(project.id, `\r\n$ ${cmd}\r\n`);
    await stream(cmd);
    return;
  }

  if (action === "clean") {
    const cmd = composeCmd("down -v");
    broadcastToHostTerminals(project.id, `\r\n$ ${cmd}\r\n`);
    await stream(cmd);
    return;
  }

  if (action === "restart") {
    const downCmd = composeCmd("down");
    broadcastToHostTerminals(project.id, `\r\n$ ${downCmd}\r\n`);
    await stream(downCmd);
    broadcastToHostTerminals(project.id, `\r\n$ ${startup}\r\n`);
    await stream(startup);
    return;
  }

  const error = new Error("unsupported_action");
  error.code = "unsupported_action";
  throw error;
}

async function getDockerContainersByNames(names) {
  if (!Array.isArray(names) || names.length === 0) return [];

  let stdout;
  try {
    ({ stdout } = await execCommand(
      "docker ps -a --format '{{.Names}}||{{.Status}}||{{.Image}}'",
      { cwd: REPO_ROOT, timeout: 10 * 1000 }
    ));
  } catch {
    return [];
  }

  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const byName = new Map();
  for (const line of lines) {
    const [name, status, image] = line.split("||");
    if (name) {
      byName.set(name, { name, status: status || "", image: image || "" });
    }
  }

  return names.map((name) => byName.get(name) || { name, status: "not found", image: "" });
}

function assertSafeContainerName(name) {
  if (typeof name !== "string") return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

function assertSafeCommand(cmd) {
  return typeof cmd === "string" && cmd.trim().length > 0 && cmd.length <= 2000;
}

function makeRingBuffer(maxLines) {
  const lines = [];
  return {
    push(line) {
      lines.push(line);
      while (lines.length > maxLines) lines.shift();
    },
    snapshot() {
      return lines.slice();
    }
  };
}

const hostTerminalSubscribers = new Map(); // basecampId -> Set<WebSocket>
const basecampOpLog = new Map(); // basecampId -> ring buffer
const scenarioFaultState = new Map(); // `${basecampId}::${scenarioId}` -> not_injected|injected|failed
let scenarioStateLoaded = false;

function getBasecampOpBuffer(basecampId) {
  const key = basecampId || "__global__";
  if (!basecampOpLog.has(key)) basecampOpLog.set(key, makeRingBuffer(200));
  return basecampOpLog.get(key);
}

function broadcastToHostTerminals(basecampId, text) {
  const key = basecampId || "__global__";
  const buf = getBasecampOpBuffer(key);
  const normalized = String(text || "").replace(/\r?\n/g, "\r\n");
  for (const line of normalized.split("\r\n")) {
    if (line.trim()) buf.push(line);
  }

  const subs = hostTerminalSubscribers.get(key);
  if (!subs) return;
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) ws.send(normalized);
  }
}

function getScenarioStateKey(basecampId, scenarioId) {
  return `${basecampId || ""}::${scenarioId || ""}`;
}

async function loadScenarioFaultStateFromDisk() {
  if (scenarioStateLoaded) return;
  try {
    const raw = await fs.readFile(SCENARIO_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed)) {
        if (value === "not_injected" || value === "injected" || value === "failed") {
          scenarioFaultState.set(key, value);
        }
      }
    }
  } catch {
    // ignore missing/invalid file
  } finally {
    scenarioStateLoaded = true;
  }
}

async function persistScenarioFaultStateToDisk() {
  const out = {};
  for (const [key, value] of scenarioFaultState.entries()) out[key] = value;
  const temp = `${SCENARIO_STATE_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(out, null, 2), "utf8");
  await fs.rename(temp, SCENARIO_STATE_FILE);
}

function readScenarioFaultState(basecampId, scenarioId) {
  const key = getScenarioStateKey(basecampId, scenarioId);
  return scenarioFaultState.get(key) || "not_injected";
}

async function writeScenarioFaultState(basecampId, scenarioId, state) {
  const key = getScenarioStateKey(basecampId, scenarioId);
  const normalized = state || "not_injected";
  if (normalized === "not_injected") {
    scenarioFaultState.delete(key);
  } else {
    scenarioFaultState.set(key, normalized);
  }
  await persistScenarioFaultStateToDisk();
}

async function clearScenarioFaultStateForBasecamp(basecampId) {
  const prefix = `${basecampId || ""}::`;
  let changed = false;
  for (const key of Array.from(scenarioFaultState.keys())) {
    if (key.startsWith(prefix)) {
      scenarioFaultState.delete(key);
      changed = true;
    }
  }
  if (changed) await persistScenarioFaultStateToDisk();
}

function spawnShellStreaming(cmd, { cwd, timeoutMs, onChunk }) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-lc", cmd], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let timedOut = false;
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGKILL");
            } catch {}
          }, timeoutMs)
        : null;

    const handle = (data) => {
      if (!data) return;
      onChunk(data.toString("utf8"));
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        const err = new Error("command_timeout");
        err.code = "command_timeout";
        reject(err);
        return;
      }
      if (code === 0) resolve();
      else {
        const err = new Error("command_failed");
        err.code = "command_failed";
        err.exitCode = code;
        reject(err);
      }
    });
  });
}

function assertSafeSize(n, fallback) {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(10, Math.min(300, Math.floor(value)));
}

function makeTerminalSessionHost() {
  // Non-TTY interactive loop with visible prompt + cwd tracking.
  const loop = [
    "cd " + JSON.stringify(REPO_ROOT),
    "while :; do",
    "  printf '[faultlab:host]%s$ ' \"$PWD\"",
    "  IFS= read -r line || exit 0",
    "  [ -z \"$line\" ] && continue",
    "  [ \"$line\" = 'exit' ] && exit 0",
    "  eval \"$line\"",
    "done"
  ].join("\n");

  return spawn("sh", ["-lc", loop], {
    cwd: REPO_ROOT,
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function simplifyContainerLabel(basecampId, container) {
  const safeBasecampId = String(basecampId || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  const name = String(container || "");
  const prefix = safeBasecampId ? `${safeBasecampId}-` : "";
  const simplified = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  return simplified || name;
}

function makeTerminalSessionContainer(basecampId, container) {
  // Same prompt loop inside container (no TTY).
  const label = simplifyContainerLabel(basecampId, container)
    .replace(/[^a-zA-Z0-9_.-]/g, "")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 32);
  const loop = [
    "while :; do",
    `  printf '[faultlab:${label || "container"}]%s$ ' "$PWD"`,
    "  IFS= read -r line || exit 0",
    "  [ -z \"$line\" ] && continue",
    "  [ \"$line\" = 'exit' ] && exit 0",
    "  eval \"$line\"",
    "done"
  ].join("\n");

  return spawn(
    "docker",
    ["exec", "-i", "-e", "TERM=xterm-256color", container, "sh", "-lc", loop],
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
}

function getContentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

async function serveStatic(reqPath, res) {
  const normalizedPath = reqPath === "/" ? "/index.html" : reqPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const absoluteFilePath = path.join(PUBLIC_DIR, safePath);
  if (!absoluteFilePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!(await pathExists(absoluteFilePath))) {
    sendText(res, 404, "Not Found");
    return;
  }

  const content = await fs.readFile(absoluteFilePath);
  res.writeHead(200, { "Content-Type": getContentType(absoluteFilePath) });
  res.end(content);
}

async function requestHandler(req, res) {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = requestUrl.pathname;

    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && pathname === "/api/projects") {
      const projects = await loadProjects();
      sendJson(res, 200, { projects });
      return;
    }

    if (req.method === "GET" && pathname === "/api/basecamps") {
      const basecamps = await loadBasecamps();
      sendJson(res, 200, { basecamps });
      return;
    }

    const basecampDetailMatch = pathname.match(/^\/api\/basecamps\/([^/]+)$/);
    if (req.method === "GET" && basecampDetailMatch) {
      const basecampId = decodeURIComponent(basecampDetailMatch[1]);
      const basecamps = await loadBasecamps();
      const basecamp = basecamps.find((item) => item.id === basecampId);
      if (!basecamp) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }
      sendJson(res, 200, { basecamp });
      return;
    }

    const startMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/start$/);
    if (req.method === "POST" && startMatch) {
      const basecampId = decodeURIComponent(startMatch[1]);
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project || typeof project.startup !== "string" || project.startup.trim() === "") {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }

      try {
        await runBasecampAction(project, "start");
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 500, { error: "basecamp start failed" });
      }
      return;
    }

    const basecampActionMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/(stop|restart|clean)$/);
    if (req.method === "POST" && basecampActionMatch) {
      const basecampId = decodeURIComponent(basecampActionMatch[1]);
      const action = basecampActionMatch[2];
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }

      try {
        await runBasecampAction(project, action);
        await clearScenarioFaultStateForBasecamp(basecampId);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        if (error?.code === "unsupported_start_command") {
          sendJson(res, 400, { error: "unsupported basecamp action for this project" });
          return;
        }
        sendJson(res, 500, { error: "basecamp action failed" });
      }
      return;
    }

    const basecampContainersMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/containers$/);
    if (req.method === "GET" && basecampContainersMatch) {
      const basecampId = decodeURIComponent(basecampContainersMatch[1]);
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }

      const topology = Array.isArray(project.topology) ? project.topology : [];
      const containers = await getDockerContainersByNames(topology);
      sendJson(res, 200, { basecamp_id: basecampId, containers });
      return;
    }

    const basecampExecMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/exec$/);
    if (req.method === "POST" && basecampExecMatch) {
      const basecampId = decodeURIComponent(basecampExecMatch[1]);
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }

      const container = body?.container;
      const cmd = body?.cmd;
      const allowed = new Set(Array.isArray(project.topology) ? project.topology : []);
      if (!assertSafeContainerName(container) || !allowed.has(container) || !assertSafeCommand(cmd)) {
        sendJson(res, 400, { error: "invalid request" });
        return;
      }

      try {
        const { stdout, stderr } = await execCommand(
          `docker exec ${container} sh -lc ${JSON.stringify(cmd)}`,
          { cwd: REPO_ROOT, timeout: 15 * 1000 }
        );
        sendJson(res, 200, { ok: true, stdout, stderr });
      } catch (error) {
        sendJson(res, 200, { ok: false, stdout: error?.stdout || "", stderr: error?.stderr || "" });
      }
      return;
    }

    const basecampScenariosMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/scenarios$/);
    if (req.method === "GET" && basecampScenariosMatch) {
      const basecampId = decodeURIComponent(basecampScenariosMatch[1]);
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }

      const scenarios = await loadProjectScenarios(project);
      const list = scenarios.map((item) => {
        const meta = item.meta || {};
        const scenarioId = meta.id || item.dir || "";
        return {
          scenario_id: scenarioId,
          title: meta.title || "",
          business_context: meta.business_context || "",
          difficulty: meta.difficulty ?? null,
          duration_min: meta.duration_min ?? null,
          duration_max: meta.duration_max ?? null,
          fault_state: readScenarioFaultState(basecampId, scenarioId)
        };
      });
      sendJson(res, 200, { basecamp_id: basecampId, scenarios: list });
      return;
    }

    const basecampScenarioDetailMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/scenarios\/([^/]+)$/);
    if (req.method === "GET" && basecampScenarioDetailMatch) {
      const basecampId = decodeURIComponent(basecampScenarioDetailMatch[1]);
      const scenarioId = decodeURIComponent(basecampScenarioDetailMatch[2]);
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }
      const scenarios = await loadProjectScenarios(project);
      const scenario = scenarios.find((item) => {
        const metaId = item?.meta?.id || "";
        return metaId === scenarioId || item.dir === scenarioId;
      });
      if (!scenario) {
        sendJson(res, 404, { error: "scenario not found" });
        return;
      }
      const meta = scenario.meta || {};
      sendJson(res, 200, {
        scenario: {
          scenario_id: meta.id || scenario.dir || "",
          title: meta.title || "",
          business_context: meta.business_context || "",
          difficulty: meta.difficulty ?? null,
          duration_min: meta.duration_min ?? null,
          duration_max: meta.duration_max ?? null,
          scenario_brief: scenario.scenario_brief || "",
          troubleshooting_guide: scenario.troubleshooting_guide || "",
          fault_state: readScenarioFaultState(basecampId, meta.id || scenario.dir || "")
        }
      });
      return;
    }

    const basecampScenarioActionMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/scenarios\/([^/]+)\/(inject|clear)$/);
    if (req.method === "POST" && basecampScenarioActionMatch) {
      const basecampId = decodeURIComponent(basecampScenarioActionMatch[1]);
      const scenarioId = decodeURIComponent(basecampScenarioActionMatch[2]);
      const action = basecampScenarioActionMatch[3];
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }
      const scenarios = await loadProjectScenarios(project);
      const scenario = scenarios.find((item) => {
        const metaId = item?.meta?.id || "";
        return metaId === scenarioId || item.dir === scenarioId;
      });
      if (!scenario) {
        sendJson(res, 404, { error: "scenario not found" });
        return;
      }
      try {
        if (action === "clear") {
          await runBasecampAction(project, "restart");
          await clearScenarioFaultStateForBasecamp(basecampId);
        } else {
          await runScenarioAction(project, scenario, action);
          await writeScenarioFaultState(basecampId, scenarioId, "injected");
        }
        sendJson(res, 200, { ok: true });
      } catch (error) {
        if (action === "inject") {
          await writeScenarioFaultState(basecampId, scenarioId, "failed");
        }
        if (error?.code === "scenario_script_not_found") {
          sendJson(res, 400, { error: "scenario script not found" });
          return;
        }
        sendJson(res, 500, { error: "scenario action failed" });
      }
      return;
    }

    const basecampScenarioStateMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/scenarios\/([^/]+)\/state$/);
    if (req.method === "GET" && basecampScenarioStateMatch) {
      const basecampId = decodeURIComponent(basecampScenarioStateMatch[1]);
      const scenarioId = decodeURIComponent(basecampScenarioStateMatch[2]);
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      if (!project) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }
      sendJson(res, 200, { fault_state: readScenarioFaultState(basecampId, scenarioId) });
      return;
    }

    const metricsSummaryMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/metrics\/summary$/);
    if (req.method === "GET" && metricsSummaryMatch) {
      const basecampId = decodeURIComponent(metricsSummaryMatch[1]);
      const basecamps = await loadBasecamps();
      const basecamp = basecamps.find((item) => item.id === basecampId);
      if (!basecamp) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }
      const summary = await collectMetricsSummary(basecampId, basecamp.status === "running");
      sendJson(res, 200, summary);
      return;
    }

    const metricsDetailMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/metrics\/detail$/);
    if (req.method === "GET" && metricsDetailMatch) {
      const basecampId = decodeURIComponent(metricsDetailMatch[1]);
      const chain = requestUrl.searchParams.get("chain") || "";
      const limit = requestUrl.searchParams.get("limit") || "40";
      const basecamps = await loadBasecamps();
      const basecamp = basecamps.find((item) => item.id === basecampId);
      if (!basecamp) {
        sendJson(res, 404, { error: "basecamp not found" });
        return;
      }
      const detail = getMetricsDetail(basecampId, chain, limit, basecamp.status === "running");
      sendJson(res, 200, detail);
      return;
    }

    const scenarioMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scenarios$/);
    if (req.method === "GET" && scenarioMatch) {
      const projectId = decodeURIComponent(scenarioMatch[1]);
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === projectId);
      if (!project) {
        sendJson(res, 404, { error: `project not found: ${projectId}` });
        return;
      }
      const scenarios = await loadProjectScenarios(project);
      sendJson(res, 200, { project_id: projectId, scenarios });
      return;
    }

    await serveStatic(pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "internal error" });
  }
}

const server = http.createServer(requestHandler);
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = requestUrl.pathname;
    if (pathname !== "/api/terminal") {
      socket.destroy();
      return;
    }

    const basecampId = requestUrl.searchParams.get("basecamp_id") || "";
    const target = requestUrl.searchParams.get("target") || "container";
    const container = requestUrl.searchParams.get("container") || "";
    const cols = assertSafeSize(requestUrl.searchParams.get("cols"), 120);
    const rows = assertSafeSize(requestUrl.searchParams.get("rows"), 32);

    if (target === "host") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, { target, basecampId, container: "", cols, rows });
      });
    } else {
      const projects = await loadProjects();
      const project = projects.find((item) => item.id === basecampId);
      const allowed = new Set(Array.isArray(project?.topology) ? project.topology : []);
      if (!project || !assertSafeContainerName(container) || !allowed.has(container)) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, { target, basecampId, container, cols, rows });
      });
    }
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws, sessionInfo) => {
  const { target, basecampId, container } = sessionInfo;
  const term = target === "host" ? makeTerminalSessionHost() : makeTerminalSessionContainer(basecampId, container);

  if (target === "host") {
    const key = basecampId || "__global__";
    if (!hostTerminalSubscribers.has(key)) hostTerminalSubscribers.set(key, new Set());
    hostTerminalSubscribers.get(key).add(ws);
    const snapshot = getBasecampOpBuffer(key).snapshot();
    if (snapshot.length) {
      ws.send(snapshot.join("\r\n") + "\r\n");
    }
  }

  function sanitizeTerminalOutput(text) {
    if (!text) return "";
    // When not running under a real TTY, some shells print job-control warnings on stderr.
    // Hide them to reduce noise for users (macOS often shows these).
    const patterns = [
      "sh: cannot set terminal process group",
      "sh: cannot set terminal process group (-1): Inappropriate ioctl for device",
      "sh: no job control in this shell"
    ];
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        text = text
          .split("\n")
          .filter((line) => !line.includes(pattern))
          .join("\n");
      }
    }
    // Normalize line endings for xterm.
    return text.replace(/\r?\n/g, "\r\n");
  }

  const send = (data) => {
    if (ws.readyState !== WebSocket.OPEN || !data) return;
    const cleaned = sanitizeTerminalOutput(data.toString("utf8"));
    if (cleaned) ws.send(cleaned);
  };

  term.stdout.on("data", send);
  term.stderr.on("data", send);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && typeof msg.data === "string") {
        // xterm Enter is usually "\r"; our line-reader expects "\n".
        term.stdin.write(msg.data.replace(/\r/g, "\n"));
      } else if (msg.type === "resize") {
        // no-op in non-pty mode
      }
    } catch {
      // ignore
    }
  });

  const cleanup = () => {
    try {
      term.kill("SIGKILL");
    } catch {
      // ignore
    }
    if (target === "host") {
      const key = basecampId || "__global__";
      const set = hostTerminalSubscribers.get(key);
      if (set) set.delete(ws);
    }
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

loadScenarioFaultStateFromDisk()
  .catch(() => {
    // ignore load error and continue start
  })
  .finally(() => {
    server.listen(PORT, HOST, () => {
      console.log(`[webapp] server running at http://${HOST}:${PORT}`);
    });
  });
