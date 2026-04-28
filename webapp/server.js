const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const yaml = require("js-yaml");

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
server.listen(PORT, HOST, () => {
  console.log(`[webapp] server running at http://${HOST}:${PORT}`);
});
