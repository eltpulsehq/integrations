# Gateways

Deployment manifests for the **eltPulse gateway** — the same image and env contract everywhere.

Pick a target:

- **[local](local/)** — laptop / dev: Docker Compose (recommended) or run from [`gateway/`](../gateway) source.
- **[docker](docker/)** — laptop, single VM, Compose (same image as “local agent”).
- **[kubernetes](kubernetes/)** — `Deployment` + `Secret` pattern.
- **[ecs](ecs/)** — Fargate-ready `task-definition.json` (wire Secrets Manager ARNs in AWS).
- **[terraform-ecs](terraform-ecs/)** — Minimal ECS task + service (variables for VPC, roles, secrets).

Image: **`ghcr.io/eltpulsehq/gateway:latest`** — built from [`../gateway`](../gateway) in this repo (pin by digest in production).
