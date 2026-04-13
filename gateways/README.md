# Gateways

Deployment manifests for the **eltPulse gateway agent** — the same image and env contract everywhere.

Pick a target:

- **[docker](docker/)** — laptop, single VM, Compose.
- **[kubernetes](kubernetes/)** — `Deployment` + `Secret` pattern.
- **[ecs](ecs/)** — Fargate-ready `task-definition.json` (wire Secrets Manager ARNs in AWS).
- **[terraform-ecs](terraform-ecs/)** — Minimal ECS task + service (variables for VPC, roles, secrets).

Image: `ghcr.io/eltpulsehq/agent:latest` (pin by digest in production).
