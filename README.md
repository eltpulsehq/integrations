# eltPulse integrations

Use **eltPulse** from **pipelines**, **CI**, **GitOps**, and **your own services** to run **hybrid data workloads**—ingestion and connectors on **your** network when policy requires it, with run metadata and secrets orchestration flowing through the **eltPulse control plane** over **outbound HTTPS only** (no inbound access from eltPulse to your VPC).

**Product:** [eltpulse.dev](https://eltpulse.dev) · **Gateway image:** `ghcr.io/eltpulsehq/agent:latest` · **Agent source:** [`eltpulsehq/agent`](https://github.com/eltpulsehq/agent)

This repository is the **public mirror** of recipes, CI snippets, Terraform/GitOps samples, and small libraries that complement the app and the gateway—not a second control plane.

**Publishing from the app monorepo:** the same tree may live under `integrations/` in [eltpulsehq/eltpulse](https://github.com/eltpulsehq/eltpulse) (or your fork) as a scaffold—copy or `git subtree split` into [github.com/eltpulsehq/integrations](https://github.com/eltpulsehq/integrations) so customers have one URL to bookmark.

---

## What you need first

1. An **eltPulse account** and (for hybrid runs) a **named gateway token** from the in-app **Gateway** page (or an **org-scoped** token if your workspace is on a qualifying plan).
2. **`ELTPULSE_CONTROL_PLANE_URL`** set to your app origin (e.g. production `https://app.…` or your self-hosted app URL).
3. **`ELTPULSE_AGENT_TOKEN`** set to the Bearer secret shown once when you create a connector—**never** commit it to Git; use CI secrets, KMS, or sealed secrets.

Most deployments use the **same** agent container everywhere; this repo holds **how** you run it (Docker, K8s, ECS, Actions, etc.).

---

## Pick your surface

| You use… | Start here |
|----------|------------|
| **Docker / laptop / jump host** | [`examples/docker`](examples/docker) |
| **Kubernetes (Helm / raw YAML)** | [`gitops/`](gitops) · [`terraform/`](terraform) (samples) |
| **AWS ECS / Fargate** | [`terraform/`](terraform) · future ECS task samples |
| **GitHub Actions** | [`github-actions/`](github-actions) |
| **GitLab CI** | [`gitlab-ci/`](gitlab-ci) |
| **Azure Pipelines** | [`azure-pipelines/`](azure-pipelines) |
| **Argo CD / Flux** | [`gitops/`](gitops) |
| **Short how-tos** | [`recipes/`](recipes) |
| **Outbound webhooks (verify signatures)** | [`webhook-starters/`](webhook-starters) |
| **OpenAPI → codegen** | [`openapi/`](openapi) (spec may live in app or agent repo) |
| **Private URL / DB → signal health** | [`probe/`](probe) (optional patterns) |
| **Shared scripts** | [`scripts/`](scripts) |
| **Orchestrator adjacency (Dagster / Airflow / Prefect)** | [`examples/`](examples) · [`libraries/`](libraries) |

### Layout (target)

| Path | Purpose |
|------|---------|
| **`examples/`** | Runnable minimal setups: Docker, sidecar with Dagster/Airflow, etc. |
| **`libraries/`** | Small optional clients or helpers (TypeScript, Python)—install from Git until published. |
| **`scripts/`** | Shell/Python one-offs: token smoke test, manifest fetch, connectivity check. |
| **`github-actions/`**, **`gitlab-ci/`**, **`azure-pipelines/`** | Copy-paste workflows for image digest pin, secret injection, deploy. |
| **`terraform/`**, **`gitops/`** | Modules and sample manifests for egress-only gateway workloads. |
| **`openapi/`** | Links or copies of OpenAPI for `/api/agent/*` where we publish machine-readable contracts. |
| **`recipes/`** | Short markdown recipes (hybrid pipeline, org default gateway, CI trigger). |
| **`webhook-starters/`** | Verify HMAC / idempotency for **incoming** triggers to eltPulse. |
| **`probe/`** | Optional: poll private endpoints from your network and POST heartbeats or metrics patterns. |

The **authoritative gateway implementation** remains in [`eltpulsehq/agent`](https://github.com/eltpulsehq/agent). This repo stays **thin**: docs, samples, and glue—similar in spirit to [servicepulsehq/integrations](https://github.com/servicepulsehq/integrations).

---

## Agent API (stable contract)

All gateway processes use the same routes (Bearer = gateway token from the app):

- `GET /api/agent/manifest`
- `GET /api/agent/runs`
- `GET /api/agent/connections`
- `POST /api/agent/heartbeat`
- `PATCH /api/agent/runs/:id`

See the in-app **Gateway** page and agent repository docs for details.

---

## Install (examples)

Clone this repo and follow the README under the surface you chose (e.g. `examples/docker`). There is **no** single PyPI/npm package required to run the gateway—the container is the default distribution.

Optional libraries under `libraries/` may document `pip install` / `npm install` from a Git subdirectory when added.

---

## Going further

- **Managed execution** — run selected pipelines on eltPulse infrastructure without a gateway; hybrid per pipeline in the app.
- **Organization gateways** — shared named tokens and org default routing (see product docs).
- **Contributing** — open PRs against this repo for new examples; keep secrets out of Git.

## License

MIT — see [`LICENSE`](LICENSE).
