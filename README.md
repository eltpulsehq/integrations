# eltPulse integrations

Everything in this repo is **for customers**: the **gateway agent** source, runnable deployment manifests, and CI examples.

**Gateway source:** [`agent/`](agent/) (Node — polls manifest/runs, heartbeats; optional stub run completion for demos).

**Container image:** **`ghcr.io/eltpulsehq/agent:latest`** — built from `agent/Dockerfile` by **[`.github/workflows/publish-ghcr.yml`](.github/workflows/publish-ghcr.yml)** on pushes to `main` (when `agent/**` changes). Package name is **`agent`** under org **`eltpulsehq`** (not the `integrations` repo name).

**Deployments:** [`gateways/`](gateways/) — Docker Compose, Kubernetes, ECS, Terraform.

---

## Gateways (start here)

| Target | Path |
|--------|------|
| **Local agent (laptop / dev)** | [`gateways/local`](gateways/local) → Docker [`gateways/docker`](gateways/docker) or run [`agent/`](agent/) with Node |
| **Docker Compose / single host** | [`gateways/docker`](gateways/docker) |
| **Kubernetes** | [`gateways/kubernetes`](gateways/kubernetes) |
| **AWS ECS (Fargate) — JSON task definition** | [`gateways/ecs`](gateways/ecs) |
| **AWS ECS — Terraform module** | [`gateways/terraform-ecs`](gateways/terraform-ecs) |

All paths assume **outbound HTTPS only** to your eltPulse app (`ELTPULSE_CONTROL_PLANE_URL`). No inbound rules from eltPulse to your network.

### Required environment

| Variable | Meaning |
|----------|---------|
| `ELTPULSE_AGENT_TOKEN` | Bearer secret from the eltPulse app (**Gateway** page — named connector). Never commit real values. |
| `ELTPULSE_CONTROL_PLANE_URL` | Origin of the app, e.g. `https://app.eltpulse.dev` |

Stable agent API: `GET /api/agent/manifest`, `GET /api/agent/runs`, `GET /api/agent/connections`, `POST /api/agent/heartbeat`, `PATCH /api/agent/runs/:id`.

---

## GHCR publish (GitHub)

1. Ensure **Actions** can write packages: repo **Settings → Actions → General → Workflow permissions → Read and write**.
2. Merge to **`main`** (or run **Actions → Publish gateway image to GHCR** manually). First run creates **`ghcr.io/eltpulsehq/agent`**.
3. Set the package to **Public** if you want unauthenticated `docker pull`.

Verify:

```bash
docker pull ghcr.io/eltpulsehq/agent:latest
```

---

## CI examples

| Path | Purpose |
|------|---------|
| [`ci/github-actions`](ci/github-actions) | Example: `GET /api/agent/manifest` smoke test with repo secrets. |

---

## License

MIT — see [`LICENSE`](LICENSE).
