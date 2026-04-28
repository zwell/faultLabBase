# Basecamp Project Spec

## Project Name

- **Name**: `basecamp`
- **Type**: FaultLab project module
- **Purpose**: Provide a continuously running, business-like baseline environment for scenario generation and troubleshooting drills.

## Project Introduction

`basecamp` is the default project module in FaultLab. It simulates a compact e-commerce workload and serves as the runtime substrate for scenario directories under `basecamp/scenarios/`.

This README is specification-oriented and intended for contributors, automation tools, and AI agents that generate or maintain scenarios in batch.

## Technology Stack

- **Runtime**: Docker Compose
- **API**: Node.js (`http` native module)
- **Data**: MySQL 8.0, Redis 7.2
- **Messaging**: Kafka 3.7
- **Traffic Entry**: Nginx
- **Traffic Generator**: Alpine + sh + curl

## Core Topology

- `basecamp-mysql`
- `basecamp-redis`
- `basecamp-kafka`
- `basecamp-api`
- `basecamp-consumer`
- `basecamp-nginx`
- `basecamp-loader`

All services communicate in `basecamp-net` and are brought up via `basecamp/docker-compose.yml`.

## Directory Contract

- `docker-compose.yml`: baseline infrastructure definition for this project
- `mysql/init.sql`: schema + seed data
- `nginx/nginx.conf`: ingress reverse proxy
- `services/`: runtime service implementations (`api`, `consumer`, `loader`)
- `scenarios/`: scenario set for this project (batch-generated and manually curated)

## Scenario Extension Policy

New scenarios for this project must be placed under:

- `basecamp/scenarios/<tech>/<id>/`

Recommended file set (depends on scenario type):

- `meta.yaml`
- `inject.sh`
- `README.md`
- `SOLUTION.md`
- `test.sh`
- `docker-compose.yml` (only when scenario is not `requires_basecamp: true`)

## Execution Baseline

From repository root:

```sh
docker compose -f basecamp/docker-compose.yml up -d
docker compose -f basecamp/docker-compose.yml ps
```

## CLI Integration

Use project-aware variables when running scenarios:

```sh
export FAULTLAB_PROJECT=basecamp
export FAULTLAB_SCENARIO=basecamp/scenarios/<tech>/<id>
./cli/faultlab.sh start
```

`FAULTLAB_SCENARIO` also supports `scenarios/<tech>/<id>` and `<tech>/<id>` forms.

## Maintenance Notes

- Keep image versions pinned and override-able via env vars.
- Avoid host-only dependencies in scripts.
- Keep this document aligned with `docs/CONTRIBUTING.md` and CLI behavior.
