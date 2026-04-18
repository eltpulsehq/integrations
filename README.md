# eltPulse integrations

Everything in this repo is **for customers**: the **gateway** source, runnable deployment manifests, and CI examples.

**Gateway source:** [`gateway/`](gateway/) (Node — polls manifest/runs, heartbeats; optional stub run completion for demos).

**Container image:** **`ghcr.io/eltpulsehq/gateway:latest`** — built from `gateway/Dockerfile` by **[`.github/workflows/publish-ghcr.yml`](.github/workflows/publish-ghcr.yml)** on pushes to `main`. GHCR package name is **`gateway`** under org **`eltpulsehq`**.

**Deployments:** [`gateways/`](gateways/) — Docker Compose, Kubernetes, ECS, Terraform.

---

## Gateways (start here)

| Target | Path |
|--------|------|
| **Local gateway (laptop / dev)** | [`gateways/local`](gateways/local) → Docker [`gateways/docker`](gateways/docker) or run [`gateway/`](gateway/) with Node |
| **Docker Compose / single host** | [`gateways/docker`](gateways/docker) |
| **Kubernetes** | [`gateways/kubernetes`](gateways/kubernetes) |
| **AWS ECS (Fargate) — JSON task definition** | [`gateways/ecs`](gateways/ecs) |
| **AWS ECS — Terraform module** | [`gateways/terraform-ecs`](gateways/terraform-ecs) |

All paths assume **outbound HTTPS only** to your eltPulse app (`ELTPULSE_CONTROL_PLANE_URL`). No inbound rules from eltPulse to your network.

### Control plane HTTP API (paths unchanged)

The gateway uses Bearer auth against:

| Route | Purpose |
|-------|---------|
| `GET /api/agent/manifest` | Poll intervals and workload snapshot |
| `GET /api/agent/runs` | Pending runs |
| `GET /api/agent/runs/:id` | Single run status — check `cancel: true` before or during execution |
| `GET /api/agent/connections` | Connection secrets |
| `POST /api/agent/heartbeat` | Liveness |
| `PATCH /api/agent/runs/:id` | Run progress — response includes `cancel: true` if user cancelled server-side |

### Cancel protocol

When a user clicks **Cancel** in the eltPulse UI, the run's status is set to `cancelled` on the control plane. The gateway detects this at two points:

1. **Before execution** — `GET /api/agent/runs/:id` is called before claiming a pending run. If `cancel: true`, the run is skipped entirely.
2. **During execution** — every `PATCH /api/agent/runs/:id` response includes `cancel: true` when the run has been cancelled. Real workload implementations should terminate their subprocess and stop sending further updates when they receive this flag.

### Required environment

| Variable | Meaning |
|----------|---------|
| `ELTPULSE_AGENT_TOKEN` | Bearer secret from the eltPulse app (**Gateway** page — named connector). |
| `ELTPULSE_CONTROL_PLANE_URL` | Origin of the app, e.g. `https://app.eltpulse.dev` |

### Optional environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `ELTPULSE_EXECUTE_RUNS` | `""` (off) | Set to `1` to enable actual run execution. Off by default so the gateway never mutates runs when first connected. |
| `ELTPULSE_WORK_DIR` | `/tmp/eltpulse` | Directory for temporary pipeline files written before each run. |
| `ELTPULSE_LOG_BATCH_LINES` | `20` | Number of output lines to buffer before flushing a progress PATCH. |
| `ELTPULSE_LOG_BATCH_MS` | `3000` | Max milliseconds to hold a log batch before flushing, regardless of line count. |

### How run execution works

When `ELTPULSE_EXECUTE_RUNS=1` the gateway:

1. **Polls** `GET /api/agent/runs?status=pending` on the interval from the manifest.
2. **Checks cancel** via `GET /api/agent/runs/:id` — skips runs cancelled before execution starts.
3. **Claims** the run with `PATCH status=running`.
4. **Fetches connection secrets** from `GET /api/agent/connections` and builds an env map.
5. **Writes pipeline files** to a temp directory:
   - `sling` pipelines → writes `replication.yaml`, runs `sling run --replication replication.yaml`
   - `dlt` pipelines → writes `pipeline.py`, runs `python3 pipeline.py`
6. **Streams stdout/stderr** back as batched `PATCH appendLog` calls while the process runs.
7. **Checks `cancel: true`** on every PATCH response — sends `SIGTERM` (then `SIGKILL` after 5 s) to the subprocess if set.
8. **Finalises** the run with `status=succeeded` or `status=failed` based on exit code.
9. **Cleans up** the temp directory.

Connection secrets stored in **Connections** are injected as environment variables automatically — the pipeline code reads them by name (e.g. `GITHUB_TOKEN`, `SNOWFLAKE_ACCOUNT`).

---

## GHCR publish (GitHub)

1. **Settings → Actions → General → Workflow permissions → Read and write**.
2. Merge to **`main`** or run **Actions → Publish gateway image to GHCR** manually. First run creates **`ghcr.io/eltpulsehq/gateway`**.
3. Set the package to **Public** if you want unauthenticated `docker pull`.

Verify:

```bash
docker pull ghcr.io/eltpulsehq/gateway:latest
```

---

## CI examples

| Path | Purpose |
|------|---------|
| [`ci/github-actions`](ci/github-actions) | Example: control-plane smoke with repo secrets. |

---

## License

MIT — see [`LICENSE`](LICENSE).
