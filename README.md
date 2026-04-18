# eltPulse integrations

Everything in this repo is **for customers**: the gateway source, worker image, deployment manifests, and CI examples.

---

## How it works

eltPulse runs your pipelines through two components you deploy:

```
eltPulse app                  Your infrastructure
─────────────────             ──────────────────────────────────────────
                              ┌─────────────────────────────────────┐
Runs page                     │  Gateway (always-on, lightweight)    │
  │ user triggers run         │                                     │
  │ status → pending  ──────▶ │  polls /api/agent/runs              │
                              │  claims run atomically              │
                              │  launches worker ──────────────────▶│
                              │  polls for cancel                   │
                              └─────────────────────────────────────┘
                                                                     │
                                             ┌───────────────────────┘
                                             ▼
                              ┌─────────────────────────────────────┐
                              │  Worker (one per run, then exits)    │
                              │                                     │
                              │  runs python3 pipeline.py           │
                              │      or sling run --replication ... │
                              │                                     │
                              │  PATCHes logs + status directly ───▶│ eltPulse app
                              └─────────────────────────────────────┘
```

**The worker talks directly to eltPulse** — it does not relay logs through the gateway. The gateway is purely a scheduler: poll, claim, launch, watch for cancel.

---

## Components

| Directory | Purpose |
|-----------|---------|
| [`gateway/`](gateway/) | Always-on polling process. Lightweight — no pipeline runtimes needed. |
| [`worker/`](worker/) | Short-lived execution container. Includes Python 3, dlt, and sling. |
| [`gateways/`](gateways/) | Deployment manifests (Docker Compose, Kubernetes, ECS, Terraform). |
| [`ci/`](ci/) | CI/CD example workflows. |

---

## Runners

The gateway supports four runners, set via `ELTPULSE_RUNNER`:

| `ELTPULSE_RUNNER` | Worker launched as | Best for |
|-------------------|--------------------|---------|
| `local` (default) | Subprocess in gateway process | Laptop / dev |
| `docker` | `docker run` via Docker socket | Single VM |
| `kubernetes` | `batch/v1 Job` | Kubernetes — scales to zero |
| `ecs` | `RunTask` on Fargate | AWS — serverless |

For `docker`, `kubernetes`, and `ecs` the gateway launches `ghcr.io/eltpulsehq/gateway-worker` as a new container/pod/task for each run. The gateway image itself stays small — it's just a Node 20 polling loop.

---

## Getting started

### 1. Get your token

Go to your eltPulse app → **Gateway** → create a named gateway token.

### 2. Choose a deployment

| Target | Path |
|--------|------|
| Local (laptop / dev) | [`gateways/local`](gateways/local) |
| Docker Compose | [`gateways/docker`](gateways/docker) |
| Kubernetes | [`gateways/kubernetes`](gateways/kubernetes) |
| AWS ECS (Fargate) — JSON task def | [`gateways/ecs`](gateways/ecs) |
| AWS ECS — Terraform | [`gateways/terraform-ecs`](gateways/terraform-ecs) |

All deployments require only **outbound HTTPS** from your network to `ELTPULSE_CONTROL_PLANE_URL`. No inbound connections from eltPulse to your infrastructure.

### 3. Enable execution

Set `ELTPULSE_EXECUTE_RUNS=1`. By default the gateway connects and heartbeats but does **not** execute runs — this lets you verify connectivity before enabling.

---

## Control plane API

The gateway and worker use Bearer auth (`ELTPULSE_AGENT_TOKEN`) against these routes:

| Route | Used by | Purpose |
|-------|---------|---------|
| `GET /api/agent/manifest` | Gateway | Poll intervals and workload snapshot |
| `GET /api/agent/runs` | Gateway | Pending runs to claim |
| `GET /api/agent/runs/:id` | Gateway + Worker | Check run status / cancel signal |
| `PATCH /api/agent/runs/:id` | Gateway + Worker | Claim run, report progress, set final status |
| `GET /api/agent/connections` | Gateway | Decrypted connection secrets to inject into worker |
| `POST /api/agent/heartbeat` | Gateway | Liveness signal |

`PATCH /api/agent/runs/:id` returns `{ cancel: true }` when the run has been cancelled by the user. Both the gateway and worker check this flag and abort execution immediately.

---

## Cancel protocol

When a user clicks **Cancel** in the eltPulse UI the run's DB status is set to `cancelled`. The gateway detects this before and during execution:

1. `GET /api/agent/runs/:id` before claiming → `cancel: true` → skip the run
2. Gateway polls `GET /api/agent/runs/:id` while the worker is running → `cancel: true` → stop the worker (stop container / delete Job / StopTask)
3. Worker checks `cancel: true` on every log PATCH it sends → self-terminates

---

## Scaling

The gateway is stateless — run as many replicas as you need. The control plane uses an **atomic claim** (`updateMany WHERE status='pending'`) so two replicas racing to claim the same run produce exactly one winner; the other gets a 409 and skips it.

`ELTPULSE_MAX_CONCURRENT_RUNS` (default 4) caps how many jobs this replica launches simultaneously. Scale horizontally by adding replicas rather than raising this number. See [`gateway/README.md`](gateway/README.md) for Kubernetes HPA and KEDA examples.

---

## Container images

Both images are built and pushed to GHCR on every push to `main`:

| Image | Contents |
|-------|----------|
| `ghcr.io/eltpulsehq/gateway:latest` | Node 20 only (~80 MB) |
| `ghcr.io/eltpulsehq/gateway-worker:latest` | Node 20 + Python 3 + dlt + sling (~800 MB) |

---

## GHCR publish setup

1. **Settings → Actions → General → Workflow permissions → Read and write**
2. Merge to `main` or run **Actions → Publish gateway images to GHCR** manually
3. Set both packages to **Public** for unauthenticated `docker pull`

---

## License

MIT — see [`LICENSE`](LICENSE).
