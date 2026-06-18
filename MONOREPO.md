# Monorepo mirror

The canonical **customer-facing** repo is [github.com/eltpulsehq/integrations](https://github.com/eltpulsehq/integrations).

This directory is a **mirror** inside the [datapulse](https://github.com/eltpulsehq/datapulse) monorepo so gateway/worker changes ship alongside control-plane API updates.

## Sync workflow

1. Develop here under `integrations/` (gateway, worker, `lib/`, deployment manifests).
2. When ready to publish for customers, push the same tree to `eltpulsehq/integrations`:

```bash
cd integrations
# verify gateway + worker locally, then:
git remote add integrations git@github.com:eltpulsehq/integrations.git  # once
rsync -a --delete --exclude '.git' ./ /tmp/integrations-push/
cd /tmp/integrations-push && git init && git remote add origin git@github.com:eltpulsehq/integrations.git
git add -A && git commit -m "sync from datapulse monorepo" && git push origin main
```

Or maintain `eltpulsehq/integrations` as the primary remote and subtree-pull into datapulse — pick one direction and stick to it.

## Layout

| Path | Role |
|------|------|
| `gateway/` | Always-on poller — claims runs, launches workers, cancel handling |
| `worker/` | Short-lived executor — `python3 pipeline.py` or `sling run` |
| `lib/` | Shared telemetry helpers (system metrics, log parsing) |
| `gateways/` | Docker Compose, K8s, ECS, Terraform samples |
| `managed-worker/` | **Legacy** — eltPulse-managed cron stub; see `worker/` for real customer execution |

## Control-plane coupling

Keep these in sync when changing run PATCH contracts:

- `integrations/lib/telemetry-log-parser.mjs` ↔ `web/lib/elt/telemetry-log-parser.ts`
- `integrations/lib/system-metrics.mjs` ↔ `web/lib/elt/agent-system-metrics.ts`
- Agent routes ↔ `gateway/README.md` API table

Declarative pipeline YAML (`eltpulse_pipeline: 2`) is applied via the control plane — workers receive compiled `pipelineCode` / `configYaml` on the run payload.
