# eltPulse gateway (reference implementation)

This is the **gateway agent** source for **`ghcr.io/eltpulsehq/agent:latest`**, maintained in **[`eltpulsehq/integrations`](https://github.com/eltpulsehq/integrations)** (there is no separate `eltpulsehq/agent` repository).

- **Node 20+**, zero runtime npm dependencies (`fetch` built-in).
- Polls **`GET /api/agent/manifest`**, **`GET /api/agent/runs`**, **`POST /api/agent/heartbeat`**, and optionally **`PATCH /api/agent/runs/:id`**.

## Run locally

```bash
export ELTPULSE_AGENT_TOKEN="…"
export ELTPULSE_CONTROL_PLANE_URL="https://app.eltpulse.dev"
# Optional: actually PATCH runs to succeeded (stub — for demos only)
# export ELTPULSE_EXECUTE_RUNS=1

node src/index.mjs
```

## Docker

From this directory:

```bash
docker build -t eltpulse-gateway:local .
docker run --rm -e ELTPULSE_AGENT_TOKEN -e ELTPULSE_CONTROL_PLANE_URL eltpulse-gateway:local
```

## Publish to GHCR

CI in the **integrations** repo root builds this folder and pushes **`ghcr.io/eltpulsehq/agent:latest`**. See [`.github/workflows/publish-ghcr.yml`](../.github/workflows/publish-ghcr.yml).

## Safety

By default the process **does not** change run status (`ELTPULSE_EXECUTE_RUNS` unset). Enable **`ELTPULSE_EXECUTE_RUNS=1`** only when you want the stub to mark pending runs **succeeded** (useful for smoke tests, harmful on real pipelines).
