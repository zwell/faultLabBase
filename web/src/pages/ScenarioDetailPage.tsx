import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { CommandPanel } from "../components/CommandPanel";
import { SubmitPanel } from "../components/SubmitPanel";
import type { ScenarioMeta } from "../types/api";

type Props = {
  onAction: (text: string) => void;
};

function historyKey(projectId: string, tech: string, scenarioId: string) {
  return `faultlab:history:${projectId}:${tech}:${scenarioId}`;
}

function loadHistory(projectId: string, tech: string, scenarioId: string): string[] {
  try {
    const key = historyKey(projectId, tech, scenarioId);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory(projectId: string, tech: string, scenarioId: string, text: string) {
  const existing = loadHistory(projectId, tech, scenarioId);
  const dedup = [text, ...existing.filter((item) => item !== text)].slice(0, 8);
  localStorage.setItem(historyKey(projectId, tech, scenarioId), JSON.stringify(dedup));
  return dedup;
}

export function ScenarioDetailPage({ onAction }: Props) {
  const { projectId = "", tech = "", scenarioId = "" } = useParams();
  const [readme, setReadme] = useState("");
  const [meta, setMeta] = useState<ScenarioMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    api
      .scenarioDetail(projectId, tech, scenarioId)
      .then((data) => {
        setReadme(data.readme);
        setMeta((data.meta || {}) as ScenarioMeta);
      })
      .catch((err) => setError((err as Error).message));
  }, [projectId, tech, scenarioId]);

  useEffect(() => {
    setHistory(loadHistory(projectId, tech, scenarioId));
  }, [projectId, tech, scenarioId]);

  const scenarioLabel = useMemo(() => meta.title || `${tech}/${scenarioId}`, [meta.title, scenarioId, tech]);

  const inject = async () => {
    try {
      const data = await api.injectScenario(projectId, tech, scenarioId);
      setTaskId(data.taskId);
      setHint("Fault injected. Start investigating logs, metrics, and system behavior.");
      onAction(`Injected ${tech}/${scenarioId}`);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submit = async (text: string) => {
    try {
      const data = await api.submitScenario(projectId, tech, scenarioId, text);
      setTaskId(data.taskId);
      setHistory(saveHistory(projectId, tech, scenarioId, text));
      onAction(`Submitted diagnosis for ${tech}/${scenarioId}`);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>{scenarioLabel}</h1>
        <Link to={`/projects/${projectId}/scenarios`}>Back</Link>
      </div>

      <div className="actions-row">
        <button onClick={() => void inject()}>Inject Fault</button>
      </div>

      {hint ? <div className="hint">{hint}</div> : null}
      {error ? <p className="error">{error}</p> : null}

      <CommandPanel taskId={taskId} onDone={(task) => onAction(`Task ${task.status}: ${task.command}`)} />

      <section className="panel">
        <h3>Scenario README</h3>
        <MarkdownViewer content={readme} />
      </section>

      <SubmitPanel
        history={history}
        onSubmit={(text) => void submit(text)}
        onReuseHistory={() => onAction(`Loaded local history for ${tech}/${scenarioId}`)}
      />
    </div>
  );
}
