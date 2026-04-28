import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TaskState } from "../types/api";

type Props = {
  taskId: string | null;
  onDone?: (task: TaskState) => void;
};

export function CommandPanel({ taskId, onDone }: Props) {
  const [task, setTask] = useState<TaskState | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!taskId) {
      return;
    }

    let timer: number | undefined;
    const poll = async () => {
      const data = await api.task(taskId);
      setTask(data);
      if (data.status === "running") {
        timer = window.setTimeout(poll, 1000);
      } else {
        onDone?.(data);
      }
    };

    void poll();

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [taskId, onDone]);

  if (!taskId || !task) {
    return null;
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <strong>Task Logs</strong>
        <div>
          <span className={`badge ${task.status}`}>{task.status}</span>
          <button onClick={() => setExpanded((v) => !v)}>{expanded ? "Collapse" : "Expand"}</button>
        </div>
      </div>
      <div className="panel-command">{task.command}</div>
      {expanded ? <pre className="panel-logs">{task.logs || "(no logs yet)"}</pre> : null}
    </section>
  );
}
