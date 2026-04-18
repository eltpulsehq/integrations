# eltPulse gateway

The gateway is a lightweight process you run in your own infrastructure. It polls the eltPulse control plane for pending pipeline runs, launches them as isolated compute, and monitors them for completion or cancellation.

**Published image:** `ghcr.io/eltpulsehq/gateway:latest`  
**Worker image:** `ghcr.io/eltpulsehq/gateway-worker:latest` (runs the actual pipeline code)

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                     eltPulse control plane                  │
│                    (app.eltpulse.dev)                       │
└───────┬──────────────────────┬──────────────────────────────┘
        │                      │
        │ 1. poll pending runs │ 3. worker PATCHes logs,
        │ 2. claim run         │    status, telemetry
        │ 4. cancel check      │    directly here
        ▼                      │
┌───────────────┐              │
│    Gateway    │              │
│  (always on)  │──launches──▶ worker (one per run)
│               │              │
│  ELTPULSE_    │              │ python3 pipeline.py
│  RUNNER=k8s   │              │     or
└───────────────┘              │ sling run --replication ...
                               │
                               └──────────────────────────────▶
                                  reports back to control plane
```

**The gateway does NOT relay pipeline logs.** The worker container communicates directly with the eltPulse control plane via `PATCH /api/agent/runs/:id`. The gateway only:
- Polls for pending runs
- Claims a run atomically (prevents double-execution across replicas)
- Launches the worker via the configured runner
- Polls for cancel signals and stops the worker if triggered

This means the gateway can stay very lightweight (no Python, no sling) — all pipeline runtime is in the worker image.

---

## Runners (`ELTPULSE_RUNNER`)

The runner controls how the worker is launched. Set `ELTPULSE_RUNNER` to one of:

| Value | How the worker runs | Best for |
|-------|---------------------|---------|
| `local` (default) | Subprocess inside the gateway process | Laptop / dev |
| `docker` | `docker run` via Docker socket | Single VM, Docker Compose |
| `kubernetes` | `batch/v1 Job` per run | Kubernetes — scales to zero, auto-cleaned |
| `ecs` | `RunTask` on Fargate | AWS — serverless, pay-per-run |

For `local`, the gateway image itself needs python3 and sling installed, or you run it directly on a host that has them. For all other runners, only the **worker image** needs the pipeline runtimes — the gateway image stays small.

---

## Quick start

### Local (dev)

```bash
export ELTPULSE_AGENT_TOKEN="your-token"
export ELTPULSE_CONTROL_PLANE_URL="https://app.eltpulse.dev"
export ELTPULSE_EXECUTE_RUNS=1   # required to actually run pipelines

node src/index.mjs
# or: docker run --rm -e ELTPULSE_AGENT_TOKEN -e ELTPULSE_CONTROL_PLANE_URL -e ELTPULSE_EXECUTE_RUNS=1 ghcr.io/eltpulsehq/gateway:latest
```

### Docker Compose

See [`../gateways/docker/`](../gateways/docker/) — mounts the Docker socket so the gateway can launch worker containers.

### Kubernetes

See [`../gateways/kubernetes/`](../gateways/kubernetes/) — includes the ServiceAccount, Role, and RoleBinding the gateway needs to create Jobs.

### ECS (Fargate)

See [`../gateways/ecs/`](../gateways/ecs/) and [`../gateways/terraform-ecs/`](../gateways/terraform-ecs/).

---

## Environment variables

### Required

| Variable | Description |
|----------|-------------|
| `ELTPULSE_AGENT_TOKEN` | Bearer token from the eltPulse app → **Gateway** page. |
| `ELTPULSE_CONTROL_PLANE_URL` | Your eltPulse app URL, e.g. `https://app.eltpulse.dev`. |

### Gateway behaviour

| Variable | Default | Description |
|----------|---------|-------------|
| `ELTPULSE_EXECUTE_RUNS` | `""` (off) | Set to `1` to enable run execution. Off by default so connecting to production never mutates runs accidentally. |
| `ELTPULSE_RUNNER` | `local` | Which runner to use: `local`, `docker`, `kubernetes`, or `ecs`. |
| `ELTPULSE_MAX_CONCURRENT_RUNS` | `4` | Max runs the gateway will launch simultaneously. For docker/kubernetes/ecs this caps how many jobs are in-flight at once — the compute itself scales independently. |
| `ELTPULSE_DRAIN_TIMEOUT_MS` | `30000` | Grace period (ms) after SIGTERM before force-exit. Lets in-flight runs finish during rolling deploys. |

### Worker image

| Variable | Default | Description |
|----------|---------|-------------|
| `ELTPULSE_WORKER_IMAGE` | `ghcr.io/eltpulsehq/gateway-worker:latest` | Worker image to launch for each run. |

### Local runner

| Variable | Default | Description |
|----------|---------|-------------|
| `ELTPULSE_WORK_DIR` | `/tmp/eltpulse` | Directory for temporary pipeline files. |
| `ELTPULSE_LOG_BATCH_LINES` | `20` | Buffer this many lines before flushing a log PATCH. |
| `ELTPULSE_LOG_BATCH_MS` | `3000` | Flush logs after this many ms even if buffer isn't full. |

### Docker runner

| Variable | Default | Description |
|----------|---------|-------------|
| `ELTPULSE_DOCKER_SOCKET` | `/var/run/docker.sock` | Path to Docker socket. |
| `ELTPULSE_WORKER_CPU` | `1024` | CPU shares for the worker container. |
| `ELTPULSE_WORKER_MEMORY` | `536870912` | Memory limit in bytes (512 MiB). |
| `ELTPULSE_WORKER_NETWORK` | `bridge` | Docker network to attach the worker to. |

### Kubernetes runner

| Variable | Default | Description |
|----------|---------|-------------|
| `ELTPULSE_K8S_NAMESPACE` | *(from service account)* | Namespace to create Jobs in. |
| `ELTPULSE_WORKER_CPU_REQUEST` | `250m` | CPU request for the worker pod. |
| `ELTPULSE_WORKER_CPU_LIMIT` | `2` | CPU limit for the worker pod. |
| `ELTPULSE_WORKER_MEM_REQUEST` | `256Mi` | Memory request for the worker pod. |
| `ELTPULSE_WORKER_MEM_LIMIT` | `1Gi` | Memory limit for the worker pod. |
| `ELTPULSE_JOB_TTL_SECONDS` | `3600` | Auto-delete finished Jobs after this many seconds. |

### ECS runner

| Variable | Required | Description |
|----------|----------|-------------|
| `ELTPULSE_ECS_CLUSTER` | yes | ECS cluster ARN or name. |
| `ELTPULSE_ECS_TASK_DEFINITION` | yes | Task definition ARN or `family:revision` to use as base. |
| `ELTPULSE_ECS_SUBNETS` | yes | Comma-separated subnet IDs for awsvpc networking. |
| `AWS_REGION` | yes | AWS region (or `AWS_DEFAULT_REGION`). |
| `ELTPULSE_ECS_SECURITY_GROUPS` | no | Comma-separated security group IDs. |
| `ELTPULSE_ECS_ASSIGN_PUBLIC_IP` | `DISABLED` | `ENABLED` or `DISABLED`. |
| `ELTPULSE_WORKER_CPU` | `512` | CPU units for the Fargate task. |
| `ELTPULSE_WORKER_MEMORY` | `1024` | Memory MiB for the Fargate task. |

AWS credentials are resolved from the standard chain: explicit `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, ECS task role, or EC2 instance profile — no AWS SDK needed.

---

## Cancel protocol

When a user clicks **Cancel** in the eltPulse UI:

1. The control plane sets the run's status to `cancelled`.
2. The gateway detects this at two points:
   - **Before claiming** — `GET /api/agent/runs/:id` returns `cancel: true`, run is skipped.
   - **During execution** — the gateway polls `GET /api/agent/runs/:id` every few seconds while the worker is running. When `cancel: true` is received, the gateway stops the worker:
     - `local` → `SIGTERM` then `SIGKILL` after 5 s
     - `docker` → `POST /containers/:id/stop`
     - `kubernetes` → `DELETE` the Job (cascades to the pod)
     - `ecs` → `StopTask`
3. The worker itself also checks `cancel: true` on every log PATCH it sends — so it can self-terminate even if the gateway is slow to react.

---

## Safety

By default (`ELTPULSE_EXECUTE_RUNS` unset) the gateway connects and heartbeats but **never modifies run status**. This lets you safely connect a gateway to production to verify connectivity before enabling execution.

---

## Images

| Image | Contents | Size |
|-------|----------|------|
| `ghcr.io/eltpulsehq/gateway:latest` | Node 20 only | ~80 MB |
| `ghcr.io/eltpulsehq/gateway-worker:latest` | Node 20 + Python 3 + dlt + sling | ~800 MB |

Both are built and pushed to GHCR automatically on every push to `main` via [`.github/workflows/publish-ghcr.yml`](../.github/workflows/publish-ghcr.yml).
