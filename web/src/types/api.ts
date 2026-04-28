export type ProjectInfo = {
  projectId: string;
  name: string;
  readmePath: string | null;
  hasScenariosDir: boolean;
  status: "up" | "down" | "unknown";
};

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

export type TaskState = {
  id: string;
  status: "running" | "completed" | "failed";
  command: string;
  logs: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
};
