import express from "express";
import cors from "cors";
import path from "node:path";
import { listProjects, readProjectReadme } from "./services/projectService";
import { listScenarios, readScenario } from "./services/scenarioService";
import {
  cleanProjectTask,
  getTask,
  injectScenarioTask,
  startProjectTask,
  submitVerifyTask,
} from "./services/commandService";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.WEB_API_PORT || 8787);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", repoRoot: REPO_ROOT });
});

app.get("/api/projects", (_req, res) => {
  try {
    const projects = listProjects(REPO_ROOT);
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/projects/:projectId/readme", (req, res) => {
  try {
    const content = readProjectReadme(REPO_ROOT, req.params.projectId);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/projects/:projectId/start", (req, res) => {
  try {
    const taskId = startProjectTask(REPO_ROOT, req.params.projectId);
    res.json({ taskId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/projects/:projectId/clean", (req, res) => {
  try {
    const taskId = cleanProjectTask(REPO_ROOT, req.params.projectId);
    res.json({ taskId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/projects/:projectId/scenarios", (req, res) => {
  try {
    const scenarios = listScenarios(REPO_ROOT, req.params.projectId);
    res.json({ scenarios });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/api/projects/:projectId/scenarios/:tech/:scenarioId", (req, res) => {
  try {
    const data = readScenario(REPO_ROOT, req.params.projectId, req.params.tech, req.params.scenarioId);
    res.json(data);
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

app.post("/api/projects/:projectId/scenarios/:tech/:scenarioId/inject", (req, res) => {
  try {
    const taskId = injectScenarioTask(REPO_ROOT, req.params.projectId, req.params.tech, req.params.scenarioId);
    res.json({ taskId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/projects/:projectId/scenarios/:tech/:scenarioId/submit", (req, res) => {
  const analysisText = String(req.body?.analysis || "").trim();
  if (!analysisText) {
    res.status(400).json({ error: "analysis is required" });
    return;
  }

  try {
    const taskId = submitVerifyTask(
      REPO_ROOT,
      req.params.projectId,
      req.params.tech,
      req.params.scenarioId,
      analysisText
    );
    res.json({ taskId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/api/tasks/:taskId/logs", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json(task);
});

app.listen(PORT, () => {
  process.stdout.write(`[web-api] listening on http://localhost:${PORT}\n`);
});
