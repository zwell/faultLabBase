import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export type ScenarioMeta = {
  id?: string;
  title?: string;
  tech?: string;
  difficulty?: number;
  duration_min?: number;
  duration_max?: number;
  resource_level?: string;
  tags?: string[];
  requires_basecamp?: boolean;
  business_context?: string;
};

export type ScenarioListItem = {
  tech: string;
  scenarioId: string;
  dirName: string;
  readmeExists: boolean;
  injectExists: boolean;
  testExists: boolean;
  meta: ScenarioMeta;
  summary: string;
};

function collectScenarioDirs(scenariosRoot: string): Array<{ tech: string; scenarioId: string; dirPath: string }> {
  if (!fs.existsSync(scenariosRoot)) {
    return [];
  }

  const techDirs = fs.readdirSync(scenariosRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  const out: Array<{ tech: string; scenarioId: string; dirPath: string }> = [];

  for (const techDir of techDirs) {
    const tech = techDir.name;
    const techPath = path.join(scenariosRoot, tech);
    const scenarioDirs = fs.readdirSync(techPath, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const scenarioDir of scenarioDirs) {
      out.push({
        tech,
        scenarioId: scenarioDir.name,
        dirPath: path.join(techPath, scenarioDir.name),
      });
    }
  }

  return out;
}

function readMeta(metaPath: string): ScenarioMeta {
  if (!fs.existsSync(metaPath)) {
    return {};
  }
  const raw = fs.readFileSync(metaPath, "utf-8");
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed as ScenarioMeta;
}

function readSummary(readmePath: string): string {
  if (!fs.existsSync(readmePath)) {
    return "";
  }
  const lines = fs
    .readFileSync(readmePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"));
  return lines.slice(0, 2).join(" ").slice(0, 280);
}

export function listScenarios(repoRoot: string, projectId: string): ScenarioListItem[] {
  const scenariosRoot = path.join(repoRoot, projectId, "scenarios");
  return collectScenarioDirs(scenariosRoot)
    .map((item) => {
      const metaPath = path.join(item.dirPath, "meta.yaml");
      const readmePath = path.join(item.dirPath, "README.md");
      const injectPath = path.join(item.dirPath, "inject.sh");
      const testPath = path.join(item.dirPath, "test.sh");

      return {
        tech: item.tech,
        scenarioId: item.scenarioId,
        dirName: item.scenarioId,
        readmeExists: fs.existsSync(readmePath),
        injectExists: fs.existsSync(injectPath),
        testExists: fs.existsSync(testPath),
        meta: readMeta(metaPath),
        summary: readSummary(readmePath),
      } as ScenarioListItem;
    })
    .sort((a, b) => a.dirName.localeCompare(b.dirName));
}

export function readScenario(repoRoot: string, projectId: string, tech: string, scenarioId: string) {
  const baseDir = path.join(repoRoot, projectId, "scenarios", tech, scenarioId);
  const readmePath = path.join(baseDir, "README.md");
  const metaPath = path.join(baseDir, "meta.yaml");

  if (!fs.existsSync(baseDir)) {
    throw new Error("Scenario directory not found");
  }

  return {
    tech,
    scenarioId,
    baseDir,
    meta: readMeta(metaPath),
    readme: fs.existsSync(readmePath)
      ? fs.readFileSync(readmePath, "utf-8")
      : "# README Not Found\n\nThis scenario does not provide a README yet.",
  };
}
