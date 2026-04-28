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

  if (action === "start") {
    await execCommand(startup, { cwd: REPO_ROOT, timeout: 5 * 60 * 1000 });
    return;
  }

  if (action === "stop") {
    await execCommand(composeCmd("down"), { cwd: REPO_ROOT, timeout: 5 * 60 * 1000 });
    return;
  }

  if (action === "clean") {
    await execCommand(composeCmd("down -v"), { cwd: REPO_ROOT, timeout: 5 * 60 * 1000 });
    return;
  }

  if (action === "restart") {
    await execCommand(composeCmd("down"), { cwd: REPO_ROOT, timeout: 5 * 60 * 1000 });
    await execCommand(startup, { cwd: REPO_ROOT, timeout: 5 * 60 * 1000 });
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
        return {
          title: meta.title || "",
          business_context: meta.business_context || "",
          difficulty: meta.difficulty ?? null,
          duration_min: meta.duration_min ?? null,
          duration_max: meta.duration_max ?? null
        };
      });
      sendJson(res, 200, { basecamp_id: basecampId, scenarios: list });
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
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

server.listen(PORT, HOST, () => {
  console.log(`[webapp] server running at http://${HOST}:${PORT}`);
});
