# eltPulse managed worker (operator / eltPulse ops)

> **Customers** on eltPulse-managed execution do not configure this.  
> **eltPulse ops** deploy `web/managed-worker-service` once and wire the control plane via `delegate`.

## Production path: eltPulse-owned workers

1. Deploy **`web/managed-worker-service`** — pick one:
   - **AWS ECS/Fargate** (recommended): `docker build` using `web/managed-worker-service/Dockerfile`
   - **Separate Vercel Python project** (see `vercel.json` in that folder)
2. On the **control plane** Vercel project:
   - `ELTPULSE_MANAGED_DELEGATE_URL` → `https://your-workers.vercel.app/batch`
   - `ELTPULSE_MANAGED_DELEGATE_SECRET` → bearer secret (same on worker)
   - `ELTPULSE_INTERNAL_API_SECRET`, `ELTPULSE_TOKEN_ENCRYPTION_KEY`, `NEXT_PUBLIC_APP_URL`
3. Cron (`/api/cron/managed-worker`, every 5 min) forwards pending runs to the worker fleet.

Customers see **eltPulse compute active** on Gateway — no GitHub, no gateway required unless they need private network access.

## Customer self-managed: gateway only

For VPC / air-gapped sources, customers switch execution plane to **You operate execution** and deploy [`../worker/`](../worker/) + [`../gateway/`](../gateway/).

GitHub Actions is **not** a customer-facing managed path.

## Legacy: GitHub Actions bootstrap

`.github/workflows/eltpulse-managed-worker.yml` + `ELTPULSE_MANAGED_EXECUTOR=gha` remain for operator bootstrap / CI. Do not expose to customers.

## Other executors

| Mode | Use |
|------|-----|
| `delegate` | Production eltPulse workers (default when delegate URL set) |
| `local` | Local dev (`npm run managed-worker:local`) |
| `vercel-python` | Vercel Services (rare) |
| `stub` | Demo telemetry when workers not provisioned |
| `gha` | Legacy explicit only |

## Internal APIs

- `GET /api/internal/managed-runs?limit=N`
- `PATCH /api/internal/managed-runs/:id`
- `GET /api/internal/managed-runs/:id/executor-context` (after claim)

## CLI (local Node)

`cd web && npm run managed-worker:local` with `ELTPULSE_MANAGED_EXECUTOR=local`.

## Legacy stub script

`run-once.mjs` — stub only; use `main.py` for real execution.
