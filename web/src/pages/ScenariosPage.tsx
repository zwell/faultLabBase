import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { ScenarioListItem } from "../types/api";

type Props = {
  onAction: (text: string) => void;
};

export function ScenariosPage({ onAction }: Props) {
  const { projectId = "" } = useParams();
  const [items, setItems] = useState<ScenarioListItem[]>([]);
  const [tech, setTech] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listScenarios(projectId)
      .then((data) => {
        setItems(data.scenarios);
        onAction(`Loaded ${data.scenarios.length} scenarios`);
      })
      .catch((err) => setError((err as Error).message));
  }, [projectId, onAction]);

  const techOptions = useMemo(() => {
    const set = new Set(items.map((i) => i.tech));
    return ["all", ...Array.from(set)];
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const techMatch = tech === "all" || item.tech === tech;
        const diffMatch =
          difficulty === "all" || String(item.meta.difficulty || "") === difficulty;
        return techMatch && diffMatch;
      }),
    [items, tech, difficulty]
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Scenarios · {projectId}</h1>
        <Link to={`/projects/${projectId}`}>Back</Link>
      </div>

      <div className="filters">
        <select value={tech} onChange={(e) => setTech(e.target.value)}>
          {techOptions.map((t) => (
            <option value={t} key={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="all">all difficulties</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="cards">
        {filtered.map((item) => (
          <article className="card" key={`${item.tech}/${item.scenarioId}`}>
            <h3>{item.meta.title || item.scenarioId}</h3>
            <p className="muted">
              {item.tech} · difficulty {item.meta.difficulty ?? "-"}
            </p>
            <p>{item.summary || "No summary in README."}</p>
            <p className="muted">
              checks: README {item.readmeExists ? "OK" : "Missing"}, inject {item.injectExists ? "OK" : "Missing"}
            </p>
            <div className="card-actions">
              <Link to={`/projects/${projectId}/scenarios/${item.tech}/${item.scenarioId}`}>Open</Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
