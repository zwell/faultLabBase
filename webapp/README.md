# FaultLab Web Scaffold

## Start

```sh
cd webapp
npm install
npm start
```

Default address: `http://localhost:4173`

## API

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:projectId/scenarios`

## Data Source

- Projects are loaded from repository root `project.yaml`.
- Scenario data is loaded by each project's `scenario_path`, searching all subdirectories that contain `meta.yaml`.
