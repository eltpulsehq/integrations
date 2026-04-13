# eltPulse integrations

Everything in this repo is **for customers**: runnable gateway deployments, CI examples, and small glue we maintain alongside the product.

**Gateway implementation (code):** [`eltpulsehq/agent`](https://github.com/eltpulsehq/agent) — intended container image **`ghcr.io/eltpulsehq/agent:latest`**.

**How to run that container** (local Docker, Kubernetes, ECS, Terraform): this repo under **`gateways/`**.

### Container image on GHCR

The docs and manifests assume **`ghcr.io/eltpulsehq/agent:latest`** is published from the **agent** repository. A ready-to-copy **GitHub Actions** workflow lives in **[`ci/agent-repo`](ci/agent-repo)** — copy it into `eltpulsehq/agent` and merge to `main` to publish (see that folder’s README for org settings and public package visibility).

**Check from your machine:**

```bash
docker pull ghcr.io/eltpulsehq/agent:latest
```

- If the pull succeeds, the image is published (and public, or you are logged in with a PAT that has `read:packages`).
- If you get **manifest unknown** or **denied**, the package may not exist yet, may only be **private** without auth, or CI may not be pushing—fix in [`eltpulsehq/agent`](https://github.com/eltpulsehq/agent) (workflow + package visibility).

Until GHCR is live, you can still run a **local agent** by building the image from the agent repo (`docker build …`) and pointing Compose/Kubernetes at that local tag.

---

## Gateways (start here)

| Target | Path |
|--------|------|
| **Local agent (laptop / dev)** | [`gateways/local`](gateways/local) → use Docker under [`gateways/docker`](gateways/docker) or build from agent source |
| **Docker Compose / single host** | [`gateways/docker`](gateways/docker) |
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
| [`ci/agent-repo`](ci/agent-repo) | **Publish** `ghcr.io/eltpulsehq/agent:latest` from `eltpulsehq/agent` (copy `.github/workflows/publish-ghcr.yml` + README). |
| [`ci/github-actions`](ci/github-actions) | Example: call `/api/agent/manifest` with repo secrets (smoke test). |

---

## License

MIT — see [`LICENSE`](LICENSE).
