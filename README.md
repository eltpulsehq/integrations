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
| `GET /api/agent/connections` | Connection secrets |
| `POST /api/agent/heartbeat` | Liveness |
| `PATCH /api/agent/runs/:id` | Run progress |

### Required environment

| Variable | Meaning |
|----------|---------|
| `ELTPULSE_AGENT_TOKEN` | Bearer secret from the eltPulse app (**Gateway** page — named connector). Variable name matches compose samples. |
| `ELTPULSE_CONTROL_PLANE_URL` | Origin of the app, e.g. `https://app.eltpulse.dev` |

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
