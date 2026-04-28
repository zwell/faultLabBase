import fs from "node:fs";
import path from "node:path";
import { runCommandSync } from "./commandService";

export type ProjectInfo = {
  projectId: string;
  name: string;
  readmePath: string | null;
  hasScenariosDir: boolean;
  status: "up" | "down" | "unknown";
};

function parseReadmeTitle(readmePath: string): string | null {
  if (!fs.existsSync(readmePath)) {
    return null;
  }
  const content = fs.readFileSync(readmePath, "utf-8");
  const firstHeading = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  return firstHeading ? firstHeading.replace(/^#\s+/, "") : null;
}

function projectStatus(projectId: string, repoRoot: string): "up" | "down" | "unknown" {
  const composeFile = path.join(repoRoot, projectId, "docker-compose.yml");
  if (!fs.existsSync(composeFile)) {
    return "unknown";
  }

  const result = runCommandSync(
    "docker",
    ["compose", "-f", composeFile, "ps", "--format", "json"],
    repoRoot
  );

  if (!result.ok) {
    return "unknown";
  }

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return "down";
  }

  const allUp = lines.every((line) => {
    try {
      const parsed = JSON.parse(line) as { State?: string; Health?: string };
      return parsed.State === "running";
    } catch {
      return false;
    }
  });

  return allUp ? "up" : "down";
}

export function listProjects(repoRoot: string): ProjectInfo[] {
  const entries = fs.readdirSync(repoRoot, { withFileTypes: true });

  const projects = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(repoRoot, name, "docker-compose.yml")))
    .map((projectId) => {
      const readmePath = path.join(repoRoot, projectId, "README.md");
      const title = parseReadmeTitle(readmePath);
      const scenariosDir = path.join(repoRoot, projectId, "scenarios");
      return {
        projectId,
        name: title || projectId,
        readmePath: fs.existsSync(readmePath) ? readmePath : null,
        hasScenariosDir: fs.existsSync(scenariosDir) && fs.statSync(scenariosDir).isDirectory(),
        status: projectStatus(projectId, repoRoot),
      } as ProjectInfo;
    });

  return projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

export function readProjectReadme(repoRoot: string, projectId: string): string {
  const readmePath = path.join(repoRoot, projectId, "README.md");
  if (!fs.existsSync(readmePath)) {
    return "# README Not Found\n\nThis project does not provide a README yet.";
  }
  return fs.readFileSync(readmePath, "utf-8");
}
