# FaultLab

Train real incident thinking, not memorized answers.

FaultLab is a local-first fault diagnosis training project where you run realistic middleware failures, investigate evidence, and submit your diagnosis through a unified CLI workflow.

## Why FaultLab

- **Realistic**: scenarios are attached to runnable services, not static quiz text.
- **Practical**: each drill follows the same loop - start, inject, observe, verify, clean.
- **Scalable**: project-based scenario layout supports batch generation and parallel evolution.
- **AI-assisted**: verify flow can evaluate your root-cause analysis against structured rubrics.

## What You Get

- Unified CLI: `./cli/faultlab.sh`
- Contributor standards and templates under `docs/`
- Default runnable project: `basecamp/`
  - baseline stack (MySQL / Redis / Kafka / API / Consumer / Nginx / Loader)
  - project-scoped scenarios under `basecamp/scenarios/`

## Quick Start

From repository root:

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/<tech>/<id>

./cli/faultlab.sh start
./cli/faultlab.sh inject
./cli/faultlab.sh verify
./cli/faultlab.sh clean
```

You can also use `scenarios/<tech>/<id>` or `<tech>/<id>`; the CLI resolves paths using `FAULTLAB_PROJECT` first.

## Run Basecamp Only

```sh
docker compose -f basecamp/docker-compose.yml up -d
```

## Repository Map

- `cli/` - command entrypoint
- `docs/` - usage guide, contribution rules, and templates
- `basecamp/` - default project module

## Documentation

- CLI guide: `docs/CLI_USAGE.md`
- Contribution rules: `docs/CONTRIBUTING.md`
- Basecamp module spec: `basecamp/README.md`

## Roadmap Direction

- Expand project modules beyond `basecamp`
- Add more business-context scenarios with consistent scoring rubrics
- Improve verify quality and feedback depth
