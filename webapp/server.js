const http = require("http");
const fsSync = require("fs");
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
const SCENARIO_ANALYSIS_FILE = path.join(__dirname, ".scenario-analysis-state.json");

function loadDotEnvFileSync(filePath) {
  try {
    if (!fsSync.existsSync(filePath)) return;
    const raw = fsSync.readFileSync(filePath, "utf8");
    for (let line of raw.split("\n")) {
      line = line.replace(/\r$/, "");
      if (!line || /^\s*#/.test(line)) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      let key = line.slice(0, eq).trim();
      if (/^export\s+/i.test(key)) key = key.replace(/^export\s+/i, "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1).replace(/\\n/g, "\n");
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore unreadable .env
  }
}

loadDotEnvFileSync(path.join(REPO_ROOT, ".env"));
loadDotEnvFileSync(path.join(__dirname, ".env"));

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

/** 降低 metrics 轮询时的重复读盘（场景目录不常变） */
const projectScenariosCache = new Map(); // projectId -> { ts, scenarios }

async function getProjectScenariosCached(project) {
  if (!project?.id) return [];
  const pid = project.id;
  const ttlMs = 60_000;
  const now = Date.now();
  const hit = projectScenariosCache.get(pid);
  if (hit && now - hit.ts < ttlMs) return hit.scenarios;
  const scenarios = await loadProjectScenarios(project);
  projectScenariosCache.set(pid, { ts: now, scenarios });
  return scenarios;
}

/** 与业务状态面板三条链路（下单 / 消息 / 存储）对齐，用于高亮与归类 */
function computeHighlightChainsForScenario(scenario) {
  const meta = scenario?.meta || {};
  const ctx = String(meta.business_context || "").toLowerCase();
  const dir = String(scenario?.dir || "").replace(/\\/g, "/").toLowerCase();
  const chains = new Set();

  if (ctx === "order") chains.add("order");
  else if (ctx === "payment") chains.add("order");
  else if (ctx === "search") chains.add("storage");
  else if (ctx === "inventory") chains.add("storage");
  else chains.add("order");

  if (dir.includes("/kafka/")) chains.add("consumer");
  if (dir.includes("/mysql/") || dir.includes("/redis/")) chains.add("storage");
  if (dir.includes("/nginx/")) chains.add("order");

  return [...chains];
}

function buildInjectedScenariosForSummary(basecampId, scenarios) {
  const rows = [];
  for (const scenario of scenarios) {
    const meta = scenario.meta || {};
    const primaryId = meta.id || scenario.dir || "";
    if (!primaryId) continue;
    const candidateIds = new Set([primaryId]);
    if (scenario.dir && scenario.dir !== primaryId) candidateIds.add(scenario.dir);
    let injected = false;
    for (const id of candidateIds) {
      if (readScenarioFaultState(basecampId, id) === "injected") {
        injected = true;
        break;
      }
    }
    if (!injected) continue;
    rows.push({
      scenario_id: primaryId,
      title: meta.title || primaryId,
      business_context: meta.business_context || "",
      highlight_chains: computeHighlightChainsForScenario(scenario)
    });
  }
  return rows;
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
    const maxBuffer = options?.maxBuffer ? options.maxBuffer : 1024 * 1024;
    exec(
      command,
      { ...options, encoding: "utf8", maxBuffer },
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

function normalizeMetricsContainers(project) {
  const raw = project?.metrics_containers;
  if (raw && typeof raw === "object") {
    const api = typeof raw.api === "string" ? raw.api : "";
    const consumer = typeof raw.consumer === "string" ? raw.consumer : "";
    const sql = typeof raw.sql === "string" ? raw.sql : typeof raw.mysql === "string" ? raw.mysql : "";
    const redis = typeof raw.redis === "string" ? raw.redis : "";
    if (!assertSafeContainerName(api) || !assertSafeContainerName(consumer)) {
      return null;
    }
    if (!assertSafeContainerName(sql) || !assertSafeContainerName(redis)) {
      return null;
    }
    const sqlEngine =
      raw.sql_engine === "postgres" || String(sql).includes("postgres") ? "postgres" : "mysql";
    return { api, consumer, sql, redis, sqlEngine };
  }
  if (project?.id === "basecamp") {
    return {
      api: "basecamp-api",
      consumer: "basecamp-consumer",
      sql: "basecamp-mysql",
      redis: "basecamp-redis",
      sqlEngine: "mysql"
    };
  }
  return null;
}

async function collectRuntimeStorageMetrics(containers) {
  if (!containers?.redis || !containers?.sql) return null;
  const { sql, redis, sqlEngine } = containers;
  if (!assertSafeContainerName(sql) || !assertSafeContainerName(redis)) return null;

  try {
    let mysqlConnections = NaN;
    let mysqlConnectionsMax = NaN;
    let mysqlActiveQueries = NaN;

    if (sqlEngine === "postgres") {
      const connOut = await execCommand(
        `docker exec ${sql} psql -U pipeline -d pipeline -t -A -c "SELECT count(*)::text FROM pg_stat_activity WHERE datname = current_database() AND usename = 'faultlab_app' AND pid <> pg_backend_pid()"`,
        { cwd: REPO_ROOT, timeout: 5 * 1000 }
      );
      const maxOut = await execCommand(
        `docker exec ${sql} psql -U pipeline -d pipeline -t -A -c "SHOW max_connections"`,
        { cwd: REPO_ROOT, timeout: 5 * 1000 }
      );
      mysqlConnections = Number(String(connOut.stdout).trim());
      mysqlConnectionsMax = Number(String(maxOut.stdout).trim());
      mysqlActiveQueries = mysqlConnections;
    } else {
      const mysqlConnOut = await execCommand(
        `docker exec ${sql} mysql -u root -proot -N -e "SHOW STATUS LIKE 'Threads_connected'"`,
        { cwd: REPO_ROOT, timeout: 5 * 1000 }
      );
      const mysqlMaxOut = await execCommand(
        `docker exec ${sql} mysql -u root -proot -N -e "SHOW VARIABLES LIKE 'max_connections'"`,
        { cwd: REPO_ROOT, timeout: 5 * 1000 }
      );
      const mysqlActiveOut = await execCommand(
        `docker exec ${sql} sh -lc "mysql -u root -proot -N -e \\"SHOW FULL PROCESSLIST\\" | wc -l"`,
        { cwd: REPO_ROOT, timeout: 5 * 1000 }
      );
      mysqlConnections = Number(String(mysqlConnOut.stdout).trim().split(/\s+/).pop());
      mysqlConnectionsMax = Number(String(mysqlMaxOut.stdout).trim().split(/\s+/).pop());
      mysqlActiveQueries = Number(String(mysqlActiveOut.stdout).trim());
    }

    const redisMemoryOut = await execCommand(`docker exec ${redis} redis-cli --raw INFO memory`, {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });
    const redisStatsOut = await execCommand(`docker exec ${redis} redis-cli --raw INFO stats`, {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });
    const redisDbsizeOut = await execCommand(`docker exec ${redis} redis-cli --raw DBSIZE`, {
      cwd: REPO_ROOT,
      timeout: 5 * 1000
    });

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

async function collectRuntimeOrderMetrics(apiContainer, projectId) {
  if (!assertSafeContainerName(apiContainer)) return null;
  try {
    const { stdout } = await execCommand(`docker logs --since 2m ${apiContainer} 2>&1`, {
      cwd: REPO_ROOT,
      timeout: 5 * 1000,
      maxBuffer: 20 * 1024 * 1024
    });
    const now = Date.now();
    const lines = String(stdout)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("[api]") && /\s(GET|POST)\s+\/\S+\s+\d+\s+\d+ms/.test(line));

    const lastMinuteEntries = [];
    for (const line of lines) {
      const match = line.match(/^\[api\]\s+(\S+)\s+(GET|POST)\s+(\S+)\s+(\d+)\s+(\d+)ms/);
      if (!match) continue;
      const ts = Date.parse(match[1]);
      if (!Number.isFinite(ts)) continue;
      if (now - ts > 60 * 1000) continue;
      lastMinuteEntries.push({
        ts,
        method: match[2],
        path: match[3],
        status: Number(match[4]),
        tookMs: Number(match[5])
      });
    }

    const writePath = projectId === "pipeline" ? "/jobs" : "/orders";
    const orderEntries = lastMinuteEntries.filter(
      (item) => item.path === writePath && item.method === "POST"
    );
    const productEntries =
      projectId === "pipeline"
        ? lastMinuteEntries.filter(
            (item) => item.method === "GET" && /^\/jobs\/[0-9]+$/.test(item.path)
          )
        : lastMinuteEntries.filter((item) => item.path.startsWith("/products"));
    const total = orderEntries.length;
    if (total === 0 && productEntries.length === 0) {
      return {
        requests_per_min: 0,
        p99_ms: 0,
        error_rate: 0,
        p95_ms: 0,
        p50_ms: 0,
        status_2xx: 0,
        status_4xx: 0,
        status_5xx: 0,
        write_success_rate: 1,
        read_success_rate: 1
      };
    }
    const latencies = orderEntries.map((item) => item.tookMs).filter((n) => Number.isFinite(n));
    const s2 = orderEntries.filter((item) => item.status >= 200 && item.status < 300).length;
    const s4 = orderEntries.filter((item) => item.status >= 400 && item.status < 500).length;
    const s5 = orderEntries.filter((item) => item.status >= 500).length;
    const errors = s4 + s5;
    const writeTotal = orderEntries.length;
    const write5xx = orderEntries.filter((item) => item.status >= 500).length;
    const readTotal = productEntries.length;
    const read5xx = productEntries.filter((item) => item.status >= 500).length;
    return {
      requests_per_min: writeTotal,
      p99_ms: round(computePercentile(latencies, 99) || 0),
      error_rate: round(writeTotal > 0 ? errors / writeTotal : 0, 4),
      p95_ms: round(computePercentile(latencies, 95) || 0),
      p50_ms: round(computePercentile(latencies, 50) || 0),
      status_2xx: s2,
      status_4xx: s4,
      status_5xx: s5,
      write_success_rate: round(writeTotal > 0 ? 1 - write5xx / writeTotal : 1, 4),
      read_success_rate: round(readTotal > 0 ? 1 - read5xx / readTotal : 1, 4)
    };
  } catch {
    return null;
  }
}

async function collectRuntimeConsumerMetrics(consumerContainer, projectId) {
  if (!assertSafeContainerName(consumerContainer)) return null;
  try {
    const { stdout } = await execCommand(`docker logs --since 2m ${consumerContainer} 2>&1`, {
      cwd: REPO_ROOT,
      timeout: 5 * 1000,
      maxBuffer: 10 * 1024 * 1024
    });
    const now = Date.now();
    const rows = [];
    for (const line of String(stdout).split("\n")) {
      let match;
      if (projectId === "pipeline") {
        match = line.match(
          /^\[worker\]\s+(\S+)\s+processed\s+job\s+id=(\S+)\s+queue_lag=(-?\d+)\s+took=(\d+)ms/
        );
      } else {
        match = line.match(
          /^\[consumer\]\s+(\S+)\s+consumed\s+\S+\s+offset=(\d+)\s+lag=(-?\d+)\s+took=(\d+)ms/
        );
      }
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
      ? { writeSuccess: 0.82, readSuccess: 0.61, p99: 3200 }
      : phase === "warn"
        ? { writeSuccess: 0.93, readSuccess: 0.92, p99: 420 }
        : { writeSuccess: 0.99, readSuccess: 0.99, p99: 28 };

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

  const writeSuccess = clamp(storageBase.writeSuccess + wave * 0.01 + randomInt(-1, 1) * 0.004, 0, 1);
  const readSuccess = clamp(storageBase.readSuccess + wave * 0.01 + randomInt(-1, 1) * 0.004, 0, 1);
  const storageP99 = clamp(Math.round(storageBase.p99 + wave * 80 + randomInt(-30, 50)), 5, 20000);

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
      write_success_rate: round(writeSuccess, 4),
      read_success_rate: round(readSuccess, 4),
      p99_ms: storageP99
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
        write_success_rate: null,
        read_success_rate: null,
        p99_ms: null
      },
      collected_at: ts,
      injected_scenarios: []
    };
    return placeholder;
  }

  await loadScenarioFaultStateFromDisk();
  const projectsForInjected = await loadProjects();
  const projectForInjected = projectsForInjected.find((item) => item.id === basecampId);
  const scenariosForInjected = projectForInjected
    ? await getProjectScenariosCached(projectForInjected)
    : [];
  const injectedScenarios = buildInjectedScenariosForSummary(basecampId, scenariosForInjected);

  const containers = projectForInjected
    ? normalizeMetricsContainers(projectForInjected)
    : null;
  const useMockFallback = !containers;

  const phase = getPhaseByTick(state.tick);
  const point = useMockFallback ? buildMockMetricsPoint(phase, state.tick) : null;

  const nullOrder = {
    requests_per_min: null,
    p99_ms: null,
    error_rate: null,
    p95_ms: null,
    p50_ms: null,
    status_2xx: null,
    status_4xx: null,
    status_5xx: null,
    write_success_rate: null,
    read_success_rate: null
  };
  const nullConsumer = { lag: null, avg_process_ms: null, offset: null, took_ms: null };
  const nullStorage = { write_success_rate: null, read_success_rate: null, p99_ms: null };

  const projectId = projectForInjected?.id || basecampId;
  const runtimeOrder = containers
    ? await collectRuntimeOrderMetrics(containers.api, projectId)
    : null;
  const runtimeConsumer = containers
    ? await collectRuntimeConsumerMetrics(containers.consumer, projectId)
    : null;

  const order = runtimeOrder ?? (useMockFallback && point ? point.order : nullOrder);
  const consumer = runtimeConsumer ?? (useMockFallback && point ? point.consumer : nullConsumer);
  let storage;
  if (runtimeOrder && Number.isFinite(runtimeOrder.p99_ms)) {
    storage = {
      write_success_rate: runtimeOrder.write_success_rate,
      read_success_rate: runtimeOrder.read_success_rate,
      p99_ms: runtimeOrder.p99_ms
    };
  } else if (useMockFallback && point) {
    storage = point.storage;
  } else {
    storage = nullStorage;
  }

  pushBounded(state.orderPoints, {
    ts,
    requests: order.requests_per_min ?? 0,
    errors:
      order.requests_per_min != null && order.error_rate != null
        ? Math.round(order.requests_per_min * order.error_rate)
        : 0,
    p99_ms: order.p99_ms ?? 0,
    p95_ms: order.p95_ms ?? 0,
    p50_ms: order.p50_ms ?? 0,
    status_2xx: order.status_2xx ?? 0,
    status_4xx: order.status_4xx ?? 0,
    status_5xx: order.status_5xx ?? 0
  });
  pushBounded(state.consumerPoints, {
    ts,
    lag: consumer.lag ?? 0,
    avg_process_ms: consumer.avg_process_ms ?? 0,
    offset: consumer.offset ?? 0,
    took_ms: consumer.took_ms ?? 0
  });
  pushBounded(state.storagePoints, {
    ts,
    write_success_rate: storage.write_success_rate ?? 0,
    read_success_rate: storage.read_success_rate ?? 0,
    p99_ms: storage.p99_ms ?? 0
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
      write_success_rate: storage.write_success_rate,
      read_success_rate: storage.read_success_rate,
      p99_ms: storage.p99_ms
    },
    collected_at: ts,
    injected_scenarios: injectedScenarios
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

function sanitizeComposeProjectId(projectId) {
  const raw = String(projectId || "").trim();
  if (!raw) return "";
  return raw.replace(/[^a-zA-Z0-9_.-]/g, "");
}

async function runBasecampAction(project, action) {
  const startup = project?.startup || "";
  const composeFile = extractComposeFileFromStartup(startup);
  if (!composeFile) {
    const error = new Error("unsupported_start_command");
    error.code = "unsupported_start_command";
    throw error;
  }

  const composeProject = sanitizeComposeProjectId(project?.id);
  const composePrefix =
    composeProject.length > 0 ? `docker compose -f ${composeFile} -p ${composeProject}` : `docker compose -f ${composeFile}`;
  const composeCmd = (args) => `${composePrefix} ${args}`;
  const stream = (cmd) =>
    spawnShellStreaming(cmd, {
      cwd: REPO_ROOT,
      timeoutMs: 5 * 60 * 1000,
      onChunk: (chunk) => broadcastToHostTerminals(project.id, chunk)
    });

  if (action === "start") {
    const startCmd = composeCmd("up -d");
    broadcastToHostTerminals(project.id, `\r\n$ ${startCmd}\r\n`);
    await stream(startCmd);
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
    const startCmd = composeCmd("up -d");
    broadcastToHostTerminals(project.id, `\r\n$ ${startCmd}\r\n`);
    await stream(startCmd);
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

const scenarioAnalysisState = new Map(); // key -> { status: "completed", updated_at: string }
let scenarioAnalysisLoaded = false;

async function loadScenarioAnalysisStateFromDisk() {
  if (scenarioAnalysisLoaded) return;
  try {
    const raw = await fs.readFile(SCENARIO_ANALYSIS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed)) {
        if (value && typeof value === "object" && value.status === "completed") {
          scenarioAnalysisState.set(key, {
            status: "completed",
            updated_at: typeof value.updated_at === "string" ? value.updated_at : new Date().toISOString()
          });
        }
      }
    }
  } catch {
    // ignore missing/invalid file
  } finally {
    scenarioAnalysisLoaded = true;
  }
}

async function persistScenarioAnalysisStateToDisk() {
  const out = {};
  for (const [key, value] of scenarioAnalysisState.entries()) out[key] = value;
  const temp = `${SCENARIO_ANALYSIS_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify(out, null, 2), "utf8");
  await fs.rename(temp, SCENARIO_ANALYSIS_FILE);
}

function readScenarioAnalysisStatus(basecampId, scenarioId) {
  const key = getScenarioStateKey(basecampId, scenarioId);
  const row = scenarioAnalysisState.get(key);
  if (row && row.status === "completed") return "completed";
  return "not_started";
}

async function writeScenarioAnalysisCompleted(basecampId, scenarioId) {
  const key = getScenarioStateKey(basecampId, scenarioId);
  scenarioAnalysisState.set(key, {
    status: "completed",
    updated_at: new Date().toISOString()
  });
  await persistScenarioAnalysisStateToDisk();
}

function isLlmConfigured() {
  const provider = String(process.env.LLM_PROVIDER || "deepseek").toLowerCase();
  if (provider === "openai") {
    return !!(process.env.OPENAI_API_KEY || process.env.LLM_API_KEY);
  }
  return !!(process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY);
}

function getLlmRuntime() {
  const providerRaw = String(process.env.LLM_PROVIDER || "deepseek").toLowerCase();
  const provider = providerRaw === "openai" ? "openai" : "deepseek";
  const apiBase = String(
    process.env.LLM_API_BASE ||
      (provider === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com/v1")
  ).replace(/\/$/, "");
  const apiKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || ""
      : process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || "";
  const model =
    process.env.LLM_MODEL || (provider === "openai" ? "gpt-4o-mini" : "deepseek-chat");
  return { provider, apiBase, apiKey, model };
}

async function readSolutionMarkdown(scenario) {
  const relDir = scenario?.dir;
  if (!relDir) return "";
  const abs = path.join(REPO_ROOT, relDir, "SOLUTION.md");
  if (!(await pathExists(abs))) return "";
  const text = await fs.readFile(abs, "utf8");
  const max = 20000;
  return text.length > max ? `${text.slice(0, max)}\n\n…（内容过长已截断用于判定）` : text;
}

function parseJsonFromModelContent(raw) {
  let text = String(raw || "").trim();
  if (!text) return null;
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/s, "");
  }
  try {
    return JSON.parse(text.trim());
  } catch {
    return null;
  }
}

const FAULTLAB_JSON_MARK = "<<<FAULTLAB_JSON>>>";

function trailingPartialMarkerLen(text, marker) {
  const max = Math.min(marker.length - 1, text.length);
  for (let len = max; len >= 1; len -= 1) {
    const suf = text.slice(-len);
    if (marker.startsWith(suf)) return len;
  }
  return 0;
}

function visibleStreamPrefix(fullText, marker) {
  const idx = fullText.indexOf(marker);
  if (idx >= 0) return fullText.slice(0, idx);
  const strip = trailingPartialMarkerLen(fullText, marker);
  return fullText.slice(0, fullText.length - strip);
}

function extractVerdictFromTail(text) {
  const tail = text.trim().slice(-1200);
  const parsed = parseJsonFromModelContent(tail);
  if (parsed?.verdict) return String(parsed.verdict).toLowerCase();
  const m = tail.match(/"verdict"\s*:\s*"([^"]+)"/i);
  if (m) return m[1].toLowerCase();
  return null;
}

function buildVerifySystemPrompt(scenarioTitle, scenarioBrief, referenceAnswer) {
  return [
    "你是 FaultLab 故障演练的导师（mentor），不是苛刻考官。",
    "你会收到「参考答案」仅供你在内心比对学习者表述；不要在回复中原样照抄参考答案的大段文字。",
    "输出分为两段：",
    "1）先写一段或多段给学习者看的正文（中文，可使用 markdown）。语气专业、简洁。",
    "   - 若对方的根因判断与参考答案一致或等价：在正文中清晰总结根因、证据与验证方式；最后可给一两句延伸阅读。",
    "   - 若对方部分正确：正文根据匹配度给出下一步排查或思考提示，不要直接给出与参考答案等价的最终根因措辞，不要一次把所有线索说完。",
    "   - 若对方明显偏离：正文指出应优先核实的数据或链路方向，不给标准答案式结论。",
    "2）正文结束后，单独起一行，**仅写**以下标记（不要前后空格）：",
    FAULTLAB_JSON_MARK,
    "下一行只输出紧凑 JSON（不要 markdown 围栏），形式：{\"verdict\":\"correct\"|\"partial\"|\"wrong\"}",
    "verdict：correct=与参考答案等价；partial=部分命中；wrong=偏离。",
    "",
    `场景标题：${scenarioTitle || "（无）"}`,
    "",
    "### 业务剧本节选（供语境）",
    String(scenarioBrief || "").slice(0, 4000) || "（无）",
    "",
    "### 参考答案（内部材料，勿泄露式照抄）",
    referenceAnswer ||
      "（本场景未提供 SOLUTION.md：请仅根据剧本节选做一般性演练点评与追问；除非对方在通用排障方法论上已非常严谨，否则 verdict 不要给 correct。）"
  ].join("\n");
}

function buildVerifyApiMessages({ scenarioTitle, scenarioBrief, referenceAnswer, learnerMessage, history }) {
  const system = buildVerifySystemPrompt(scenarioTitle, scenarioBrief, referenceAnswer);
  const hist = Array.isArray(history) ? history.slice(-12) : [];
  const apiMessages = [{ role: "system", content: system }];
  for (const h of hist) {
    const role = h.role === "assistant" ? "assistant" : "user";
    const c = h.content != null ? String(h.content).trim() : "";
    if (c) apiMessages.push({ role, content: c });
  }
  apiMessages.push({ role: "user", content: String(learnerMessage || "").trim() });
  return apiMessages;
}

async function collectChatCompletionStream(responseBody, onDelta) {
  const reader = responseBody.getReader();
  const decoder = new TextDecoder("utf-8");
  let carry = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    let split;
    while ((split = carry.indexOf("\n\n")) !== -1) {
      const block = carry.slice(0, split);
      carry = carry.slice(split + 2);
      for (const line of block.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") continue;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        const piece = j?.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece.length) {
          if (onDelta) onDelta(piece);
        }
      }
    }
  }
  for (const line of carry.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") continue;
    let j;
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    const piece = j?.choices?.[0]?.delta?.content;
    if (typeof piece === "string" && piece.length && onDelta) onDelta(piece);
  }
}

async function runVerifyStreamToClient(res, apiMessages, signal) {
  const cfg = getLlmRuntime();
  if (!cfg.apiKey) {
    const err = new Error("llm_not_configured");
    err.code = "llm_not_configured";
    throw err;
  }
  const url = `${cfg.apiBase}/chat/completions`;
  const resUp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: apiMessages,
      temperature: 0.25,
      stream: true
    }),
    signal
  });
  if (!resUp.ok) {
    const t = await resUp.text();
    const err = new Error("llm_upstream");
    err.code = "llm_upstream";
    err.detail = t.slice(0, 800);
    throw err;
  }
  if (!resUp.body) {
    const err = new Error("llm_no_body");
    err.code = "llm_upstream";
    throw err;
  }

  let fullText = "";
  let sentVisibleLen = 0;

  function flushToClient() {
    const vis = visibleStreamPrefix(fullText, FAULTLAB_JSON_MARK);
    if (vis.length > sentVisibleLen) {
      const piece = vis.slice(sentVisibleLen);
      sentVisibleLen = vis.length;
      if (piece) {
        res.write(`data: ${JSON.stringify({ type: "token", text: piece })}\n\n`);
      }
    }
  }

  await collectChatCompletionStream(resUp.body, (delta) => {
    fullText += delta;
    flushToClient();
  });
  flushToClient();

  let reply = "";
  let verdict = "partial";
  const idx = fullText.indexOf(FAULTLAB_JSON_MARK);
  if (idx >= 0) {
    reply = fullText.slice(0, idx).trim();
    const tail = fullText.slice(idx + FAULTLAB_JSON_MARK.length).trim();
    const pj = parseJsonFromModelContent(tail);
    if (pj?.verdict) verdict = String(pj.verdict).toLowerCase();
  } else {
    reply = visibleStreamPrefix(fullText, FAULTLAB_JSON_MARK).trim();
    const v2 = extractVerdictFromTail(fullText);
    if (v2) verdict = v2;
  }
  if (!["correct", "partial", "wrong"].includes(verdict)) verdict = "partial";
  if (!reply) reply = "（未生成可见正文，请重试。）";
  return { verdict, reply };
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
      sendJson(res, 200, { status: "ok", llm_ready: isLlmConfigured() });
      return;
    }

    if (req.method === "GET" && pathname === "/api/ui-config") {
      // Control whether scenario fault injection UI is exposed.
      // Set FAULTLAB_SHOW_SCENARIO_INJECT_UI=0 to hide injection controls in production.
      const showScenarioInjectUi = process.env.FAULTLAB_SHOW_SCENARIO_INJECT_UI !== "0";
      // Default off: set FAULTLAB_AUTO_INJECT_ON_PAGE=1 to enable auto-injection on scenario page load.
      const autoInjectOnPage = process.env.FAULTLAB_AUTO_INJECT_ON_PAGE === "1";
      sendJson(res, 200, {
        showScenarioInjectUi,
        enableScenarioInjection: showScenarioInjectUi,
        autoInjectOnPage,
        llmReady: isLlmConfigured()
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/runtime-config") {
      sendJson(res, 200, { isDev: process.env.IS_DEV === "1" || process.env.NODE_ENV !== "production" });
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
          title_reveal: meta.title_reveal || "",
          business_context: meta.business_context || "",
          difficulty: meta.difficulty ?? null,
          duration_min: meta.duration_min ?? null,
          duration_max: meta.duration_max ?? null,
          fault_state: readScenarioFaultState(basecampId, scenarioId),
          analysis_status: readScenarioAnalysisStatus(basecampId, scenarioId)
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
          title_reveal: meta.title_reveal || "",
          business_context: meta.business_context || "",
          difficulty: meta.difficulty ?? null,
          duration_min: meta.duration_min ?? null,
          duration_max: meta.duration_max ?? null,
          scenario_brief: scenario.scenario_brief || "",
          troubleshooting_guide: scenario.troubleshooting_guide || "",
          fault_state: readScenarioFaultState(basecampId, meta.id || scenario.dir || ""),
          analysis_status: readScenarioAnalysisStatus(basecampId, meta.id || scenario.dir || "")
        }
      });
      return;
    }

    const basecampScenarioVerifyMatch = pathname.match(/^\/api\/basecamps\/([^/]+)\/scenarios\/([^/]+)\/verify$/);
    if (req.method === "POST" && basecampScenarioVerifyMatch) {
      if (!isLlmConfigured()) {
        sendJson(res, 503, {
          error: "llm_not_configured",
          message: "未配置 LLM。请设置 DEEPSEEK_API_KEY（默认）或 LLM_API_KEY，或将 LLM_PROVIDER=openai 并设置 OPENAI_API_KEY。"
        });
        return;
      }
      const basecampId = decodeURIComponent(basecampScenarioVerifyMatch[1]);
      const scenarioId = decodeURIComponent(basecampScenarioVerifyMatch[2]);
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }
      const message = body?.message != null ? String(body.message).trim() : "";
      if (!message) {
        sendJson(res, 400, { error: "message required" });
        return;
      }
      if (message.length > 12000) {
        sendJson(res, 400, { error: "message too long" });
        return;
      }
      const historyRaw = body?.history;
      const history = [];
      if (Array.isArray(historyRaw)) {
        for (const row of historyRaw.slice(-12)) {
          if (!row || typeof row !== "object") continue;
          const role = row.role === "assistant" ? "assistant" : "user";
          const content = row.content != null ? String(row.content).trim() : "";
          if (content) history.push({ role, content });
        }
      }
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
      const title = meta.title || "";
      const brief = scenario.scenario_brief || "";
      let referenceAnswer = "";
      try {
        referenceAnswer = await readSolutionMarkdown(scenario);
      } catch {
        referenceAnswer = "";
      }
      const apiMessages = buildVerifyApiMessages({
        scenarioTitle: title,
        scenarioBrief: brief,
        referenceAnswer,
        learnerMessage: message,
        history
      });

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      const controller = new AbortController();
      const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 120000);
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const { verdict, reply } = await runVerifyStreamToClient(res, apiMessages, controller.signal);
        let analysisStatus = readScenarioAnalysisStatus(basecampId, scenarioId);
        if (verdict === "correct") {
          await writeScenarioAnalysisCompleted(basecampId, scenarioId);
          analysisStatus = "completed";
        }
        res.write(
          `data: ${JSON.stringify({
            type: "done",
            verdict,
            analysis_status: analysisStatus,
            reply_full: reply
          })}\n\n`
        );
        res.end();
      } catch (error) {
        if (error?.name === "AbortError") {
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              code: "llm_timeout",
              message: "上游请求超时"
            })}\n\n`
          );
        } else if (error?.code === "llm_not_configured") {
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              code: "llm_not_configured",
              message: "未配置 LLM"
            })}\n\n`
          );
        } else if (error?.code === "llm_upstream") {
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              code: "llm_upstream",
              message: "模型服务错误",
              detail: error.detail || ""
            })}\n\n`
          );
        } else {
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              code: "verify_failed",
              message: error?.message || "verify failed"
            })}\n\n`
          );
        }
        res.end();
      } finally {
        clearTimeout(timer);
      }
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
  .then(() => loadScenarioAnalysisStateFromDisk())
  .catch(() => {
    // ignore load error and continue start
  })
  .finally(() => {
    server.listen(PORT, HOST, () => {
      console.log(`[webapp] server running at http://${HOST}:${PORT}`);
    });
  });
