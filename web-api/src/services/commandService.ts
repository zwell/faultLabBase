import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

export type CommandResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type TaskState = {
  id: string;
  status: "running" | "completed" | "failed";
  command: string;
  logs: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
};

const taskStore = new Map<string, TaskState>();

export function getTask(taskId: string): TaskState | null {
  return taskStore.get(taskId) || null;
}

export function runCommandSync(command: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    shell: false,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function appendTaskLog(taskId: string, text: string) {
  const task = taskStore.get(taskId);
  if (!task) {
    return;
  }
  task.logs += text;
}

export function runTask(command: string, args: string[], cwd: string, stdinText?: string): string {
  const taskId = randomUUID();
  taskStore.set(taskId, {
    id: taskId,
    status: "running",
    command: [command, ...args].join(" "),
    logs: "",
    startedAt: new Date().toISOString(),
  });

  const proc = spawn(command, args, {
    cwd,
    shell: false,
    env: process.env,
  });

  proc.stdout.on("data", (chunk: Buffer) => appendTaskLog(taskId, chunk.toString("utf-8")));
  proc.stderr.on("data", (chunk: Buffer) => appendTaskLog(taskId, chunk.toString("utf-8")));

  proc.on("close", (code) => {
    const task = taskStore.get(taskId);
    if (!task) {
      return;
    }
    task.exitCode = code ?? 1;
    task.status = (code ?? 1) === 0 ? "completed" : "failed";
    task.finishedAt = new Date().toISOString();
  });

  proc.on("error", (err) => {
    appendTaskLog(taskId, `\n[task-error] ${err.message}\n`);
    const task = taskStore.get(taskId);
    if (!task) {
      return;
    }
    task.exitCode = 1;
    task.status = "failed";
    task.finishedAt = new Date().toISOString();
  });

  if (stdinText) {
    proc.stdin.write(stdinText);
    proc.stdin.end();
  }

  return taskId;
}

export function projectComposeFile(repoRoot: string, projectId: string): string {
  return path.join(repoRoot, projectId, "docker-compose.yml");
}

export function startProjectTask(repoRoot: string, projectId: string): string {
  const composeFile = projectComposeFile(repoRoot, projectId);
  if (!fs.existsSync(composeFile)) {
    throw new Error("Project docker-compose.yml not found");
  }
  return runTask("docker", ["compose", "-f", composeFile, "up", "-d"], repoRoot);
}

export function cleanProjectTask(repoRoot: string, projectId: string): string {
  const composeFile = projectComposeFile(repoRoot, projectId);
  if (!fs.existsSync(composeFile)) {
    throw new Error("Project docker-compose.yml not found");
  }
  return runTask("docker", ["compose", "-f", composeFile, "down", "-v", "--remove-orphans"], repoRoot);
}

export function injectScenarioTask(repoRoot: string, projectId: string, tech: string, scenarioId: string): string {
  const injectPath = path.join(repoRoot, projectId, "scenarios", tech, scenarioId, "inject.sh");
  if (!fs.existsSync(injectPath)) {
    throw new Error("inject.sh not found");
  }
  return runTask("sh", [injectPath], repoRoot);
}

export function submitVerifyTask(
  repoRoot: string,
  projectId: string,
  tech: string,
  scenarioId: string,
  analysisText: string
): string {
  const cliPath = path.join(repoRoot, "cli", "faultlab.sh");
  if (!fs.existsSync(cliPath)) {
    throw new Error("cli/faultlab.sh not found");
  }

  const envBackup = {
    FAULTLAB_PROJECT: process.env.FAULTLAB_PROJECT,
    FAULTLAB_SCENARIO: process.env.FAULTLAB_SCENARIO,
  };

  process.env.FAULTLAB_PROJECT = projectId;
  process.env.FAULTLAB_SCENARIO = `${projectId}/scenarios/${tech}/${scenarioId}`;

  const taskId = runTask("sh", [cliPath, "verify"], repoRoot, analysisText + "\n");

  process.env.FAULTLAB_PROJECT = envBackup.FAULTLAB_PROJECT;
  process.env.FAULTLAB_SCENARIO = envBackup.FAULTLAB_SCENARIO;

  return taskId;
}
