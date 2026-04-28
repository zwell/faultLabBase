type Props = {
  dockerStatus: "ready" | "unavailable";
  project?: string;
  scenario?: string;
  lastAction?: string;
};

export function StatusBar({ dockerStatus, project, scenario, lastAction }: Props) {
  return (
    <div className="status-bar">
      <span>Docker: {dockerStatus === "ready" ? "Ready" : "Unavailable"}</span>
      <span>Project: {project || "-"}</span>
      <span>Scenario: {scenario || "-"}</span>
      <span>Last Action: {lastAction || "-"}</span>
    </div>
  );
}
