import type { ProjectInfo, ScenarioListItem, TaskState } from "../types/api";

const API_BASE = import.meta.env.VITE_WEB_API_BASE || "http://localhost:8787";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),
  listProjects: () => request<{ projects: ProjectInfo[] }>("/api/projects"),
  projectReadme: (projectId: string) => request<{ content: string }>(`/api/projects/${projectId}/readme`),
  startProject: (projectId: string) =>
    request<{ taskId: string }>(`/api/projects/${projectId}/start`, { method: "POST" }),
  cleanProject: (projectId: string) =>
    request<{ taskId: string }>(`/api/projects/${projectId}/clean`, { method: "POST" }),
  listScenarios: (projectId: string) =>
    request<{ scenarios: ScenarioListItem[] }>(`/api/projects/${projectId}/scenarios`),
  scenarioDetail: (projectId: string, tech: string, scenarioId: string) =>
    request<{ readme: string; meta: unknown }>(`/api/projects/${projectId}/scenarios/${tech}/${scenarioId}`),
  injectScenario: (projectId: string, tech: string, scenarioId: string) =>
    request<{ taskId: string }>(`/api/projects/${projectId}/scenarios/${tech}/${scenarioId}/inject`, {
      method: "POST",
    }),
  submitScenario: (projectId: string, tech: string, scenarioId: string, analysis: string) =>
    request<{ taskId: string }>(`/api/projects/${projectId}/scenarios/${tech}/${scenarioId}/submit`, {
      method: "POST",
      body: JSON.stringify({ analysis }),
    }),
  task: (taskId: string) => request<TaskState>(`/api/tasks/${taskId}/logs`),
};
