# eltPulse gateway (reference implementation)

This directory is the **gateway** process customers run in their environment: it talks to the eltPulse control plane over **HTTPS** using a named connector token.

Published image: **`ghcr.io/eltpulsehq/gateway:latest`** (built from this folder by the integrations repo’s GitHub Actions).

- **Node 20+**, no runtime npm dependencies (`fetch` built-in).
- Calls the control plane routes under **`/api/agent/*`** (URL path is fixed; the product name is **gateway**).

## Run locally

```bash
export ELTPULSE_AGENT_TOKEN="…"
export ELTPULSE_CONTROL_PLANE_URL="https://app.eltpulse.dev"
# Optional: stub-complete pending runs (demos only)
# export ELTPULSE_EXECUTE_RUNS=1

node src/index.mjs
```

`ELTPULSE_AGENT_TOKEN` matches the variable name used in Docker Compose samples and the in-app Gateway copy-paste.

## Docker

```bash
docker build -t eltpulse-gateway:local .
docker run --rm -e ELTPULSE_AGENT_TOKEN -e ELTPULSE_CONTROL_PLANE_URL eltpulse-gateway:local
```

## Publish to GHCR

See **[`.github/workflows/publish-ghcr.yml`](../.github/workflows/publish-ghcr.yml)** at the integrations repo root.

## Safety

By default the process **does not** change run status. **`ELTPULSE_EXECUTE_RUNS=1`** enables the stub that marks pending runs **succeeded** — use only for smoke tests.
