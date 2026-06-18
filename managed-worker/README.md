# eltPulse managed worker (legacy — eltPulse SaaS only)

> **Customer agents:** use [`../worker/`](../worker/) + [`../gateway/`](../gateway/) instead.  
> This folder is for **eltPulse-managed** runs via internal APIs (`/api/internal/managed-runs*`), not customer Bearer tokens.

Managed runs use internal APIs (`/api/internal/managed-runs*`). **Default behavior:** if you set **GitHub dispatch** env vars on Vercel, the app **auto-selects `gha`** so real dlt/Sling runs on **GitHub Actions** — you do **not** need Vercel “Services”.

---

## Fast path (recommended): GitHub Actions + Vercel cron

1. **Repo → Settings → Secrets and variables → Actions** — add secrets:
   - `ELTPULSE_CONTROL_PLANE_URL` — your production app URL, e.g. `https://app.yourdomain.com`
   - `ELTPULSE_INTERNAL_API_SECRET` — same value as on Vercel (must match `ELTPULSE_INTERNAL_API_SECRET` in the app)

2. **Vercel project env** (production + preview as you prefer):
   - `ELTPULSE_GITHUB_DISPATCH_TOKEN` — fine-grained PAT or classic PAT with **`actions:write`** on this repo
   - `ELTPULSE_GITHUB_REPOSITORY` — `owner/repo` (this repository)
   - Optional: `ELTPULSE_GITHUB_WORKFLOW_FILE` (default `eltpulse-managed-worker.yml`), `ELTPULSE_GITHUB_DISPATCH_REF` (default `main`)

3. **Leave `ELTPULSE_MANAGED_EXECUTOR` unset** — if the two GitHub vars above are set, the app defaults to **`gha`**: each `/api/cron/managed-worker` tick **dispatches** the workflow. Work runs on `ubuntu-latest` with real Python (`web/managed-worker-service/main.py` via `python main.py`).

4. To **force stub** demos while keeping PAT in env: `ELTPULSE_MANAGED_EXECUTOR=stub`.

Workflow file: **`.github/workflows/eltpulse-managed-worker.yml`** (dispatch + manual **Run workflow**).

Cron response includes `githubDispatched: true` when only the dispatch ran (runs finish asynchronously on GitHub).

---

## Option B: second deployment (`delegate`)

1. Deploy **`web/managed-worker-service`** as its **own** Vercel project (Root Directory = `web/managed-worker-service`). Optional: `vercel.json` there sets `maxDuration` 900.
2. Set on the worker: `ELTPULSE_CONTROL_PLANE_URL`, `ELTPULSE_INTERNAL_API_SECRET`, `ELTPULSE_MANAGED_VERCEL_PYTHON_SECRET`.
3. On the main app: `ELTPULSE_MANAGED_EXECUTOR=delegate`, `ELTPULSE_MANAGED_DELEGATE_URL` = full `POST` URL to worker’s `/batch`, `ELTPULSE_MANAGED_DELEGATE_SECRET` = same bearer as worker’s `ELTPULSE_MANAGED_VERCEL_PYTHON_SECRET`.

If the main app is **delegate-only**, you can keep **`web/vercel.json`** without any `experimentalServices` block (plain Next.js).

---

## Option C: Vercel Services (same domain `/managed-elt`)

Only if your Vercel account has **Services** enabled. Set `ELTPULSE_MANAGED_EXECUTOR=vercel-python` and restore **`experimentalServices`** in `web/vercel.json` (see git history). Most accounts do **not** show “Services” in the UI — use **gha** or **delegate** instead.

**“Function CPU”** in Vercel is unrelated (serverless sizing), not polyglot Services.

---

## Queuing + 15 minutes

- **`limit=1` per batch:** one run per invocation; **~900s** max for that invocation on long runners.
- **More pending runs:** wait for the **next** cron tick or another dispatch unless you run workers in parallel.
- **`limit>1` in one batch:** runs are **sequential** and **share** one wall-clock budget.

---

## Other env (reference)

| Variable | Where | Purpose |
|----------|--------|---------|
| `CRON_SECRET` | Vercel | Cron auth |
| `ELTPULSE_INTERNAL_API_SECRET` | Vercel + GHA secrets | Internal API bearer |
| `ELTPULSE_TOKEN_ENCRYPTION_KEY` | Vercel | Decrypt connection secrets in `executor-context` |
| `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` / `ELTPULSE_CRON_APP_URL` / `ELTPULSE_CONTROL_PLANE_URL` | Vercel | Resolve control-plane origin for cron self-calls |

**Executors:** `stub` | `gha` | `local` | `delegate` | `vercel-python`

---

## Internal APIs

- `GET /api/internal/managed-runs?limit=N`
- `PATCH /api/internal/managed-runs/:id`
- `GET /api/internal/managed-runs/:id`
- `GET /api/internal/managed-runs/:id/executor-context` (after claim)

## CLI (local Node)

`cd web && npm run managed-worker:local` with `ELTPULSE_MANAGED_EXECUTOR=local`.

## Legacy stub script

`integrations/managed-worker/run-once.mjs` — stub only.

Customer gateways **must not** poll managed runs.
