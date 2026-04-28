import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ProjectInfo } from "../types/api";

type Props = {
  onAction: (text: string) => void;
};

export function ProjectsPage({ onAction }: Props) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await api.listProjects();
      setProjects(data.projects);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(
    () =>
      projects.filter((p) =>
        `${p.projectId} ${p.name}`.toLowerCase().includes(keyword.trim().toLowerCase())
      ),
    [keyword, projects]
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>Projects</h1>
        <button onClick={() => void refresh()}>Refresh</button>
      </div>

      <input
        className="search"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="Search project by id or name"
      />

      {loading ? <p>Loading projects...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && !filtered.length ? (
        <div className="empty-state">
          <p>No projects found.</p>
          <p>Project should include docker-compose.yml and optional scenarios directory.</p>
        </div>
      ) : null}

      <div className="cards">
        {filtered.map((project) => (
          <article className="card" key={project.projectId}>
            <h3>{project.name}</h3>
            <p className="muted">ID: {project.projectId}</p>
            <p>Status: {project.status}</p>
            <p>Scenarios dir: {project.hasScenariosDir ? "Yes" : "No"}</p>
            <div className="card-actions">
              <Link to={`/projects/${project.projectId}`}>Open</Link>
              <button onClick={() => onAction(`Selected project ${project.projectId}`)}>Select</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
