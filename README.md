# eltPulse integrations

Everything in this repo is **for customers**: runnable gateway deployments, CI examples, and small glue we maintain alongside the product.

**Gateway implementation (code):** [`eltpulsehq/agent`](https://github.com/eltpulsehq/agent) — container `ghcr.io/eltpulsehq/agent:latest`.

**How to run that container** (Docker, Kubernetes, ECS, Terraform): this repo under **`gateways/`**.

---

## Gateways (start here)

| Target | Path |
|--------|------|
| **Local / VM / Docker Compose** | [`gateways/docker`](gateways/docker) |
| **Kubernetes** | [`gateways/kubernetes`](gateways/kubernetes) |
| **AWS ECS (Fargate) — JSON task definition** | [`gateways/ecs`](gateways/ecs) |
| **AWS ECS — Terraform module** | [`gateways/terraform-ecs`](gateways/terraform-ecs) |

All paths assume **outbound HTTPS only** to your eltPulse app (`ELTPULSE_CONTROL_PLANE_URL`) and whatever data plane endpoints you configure in eltPulse. No inbound rules from eltPulse to your network.

### Required environment

| Variable | Meaning |
|----------|---------|
| `ELTPULSE_AGENT_TOKEN` | Bearer secret from the eltPulse app (**Gateway** page — named connector). Never commit real values. |
| `ELTPULSE_CONTROL_PLANE_URL` | Origin of the app, e.g. `https://app.eltpulse.dev` |

Stable agent API: `GET /api/agent/manifest`, `GET /api/agent/runs`, `GET /api/agent/connections`, `POST /api/agent/heartbeat`, `PATCH /api/agent/runs/:id`.

---

## CI

| Path | Purpose |
|------|---------|
| [`ci/github-actions`](ci/github-actions) | Example workflow: call `/api/agent/manifest` with repo secrets (smoke test). |

---

## License

MIT — see [`LICENSE`](LICENSE).
