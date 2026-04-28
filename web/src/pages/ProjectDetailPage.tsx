import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { MarkdownViewer } from "../components/MarkdownViewer";
import { CommandPanel } from "../components/CommandPanel";

type Props = {
  onAction: (text: string) => void;
};

export function ProjectDetailPage({ onAction }: Props) {
  const { projectId = "" } = useParams();
  const [readme, setReadme] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => projectId || "Project", [projectId]);

  useEffect(() => {
    if (!projectId) return;
    api
      .projectReadme(projectId)
      .then((data) => {
        setReadme(data.content);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  }, [projectId]);

  const runAction = async (kind: "start" | "clean") => {
    try {
      const task = kind === "start" ? await api.startProject(projectId) : await api.cleanProject(projectId);
      setTaskId(task.taskId);
      onAction(`${kind === "start" ? "Started" : "Cleaned"} ${projectId}`);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
        <Link to="/">Back</Link>
      </div>

      <div className="actions-row">
        <button onClick={() => void runAction("start")}>Start Project</button>
        <button className="danger" onClick={() => void runAction("clean")}>Clean Project</button>
        <Link to={`/projects/${projectId}/scenarios`}>Open Scenarios</Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <CommandPanel taskId={taskId} onDone={(task) => onAction(`Task ${task.status}: ${task.command}`)} />

      <section className="panel">
        <h3>Project README</h3>
        <MarkdownViewer content={readme} />
      </section>
    </div>
  );
}
