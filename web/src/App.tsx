import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { StatusBar } from "./components/StatusBar";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectDetailPage } from "./pages/ProjectDetailPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { ScenarioDetailPage } from "./pages/ScenarioDetailPage";
import { api } from "./lib/api";

function App() {
  const [dockerStatus, setDockerStatus] = useState<"ready" | "unavailable">("unavailable");
  const [lastAction, setLastAction] = useState("");

  useEffect(() => {
    api
      .health()
      .then(() => setDockerStatus("ready"))
      .catch(() => setDockerStatus("unavailable"));
  }, []);

  return (
    <div className="app-shell">
      <StatusBar dockerStatus={dockerStatus} lastAction={lastAction} />
      <Routes>
        <Route path="/" element={<ProjectsPage onAction={setLastAction} />} />
        <Route path="/projects/:projectId" element={<ProjectDetailPage onAction={setLastAction} />} />
        <Route
          path="/projects/:projectId/scenarios"
          element={<ScenariosPage onAction={setLastAction} />}
        />
        <Route
          path="/projects/:projectId/scenarios/:tech/:scenarioId"
          element={<ScenarioDetailPage onAction={setLastAction} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
