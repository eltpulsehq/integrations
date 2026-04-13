# Local agent (laptop / dev machine)

The gateway agent is the **same binary** everywhere. On your own machine you usually run it as a **container** (simplest) or build **from source** when you are developing the agent itself.

## Option A — Docker (recommended for local)

Use **[`../docker`](../docker/)**: `docker compose` with `.env` holding `ELTPULSE_AGENT_TOKEN` and `ELTPULSE_CONTROL_PLANE_URL`. No Kubernetes or cloud required.

That is the supported “local agent” path for eltPulse customers: one long-lived container with outbound HTTPS to the app.

## Option B — Run from source (agent developers)

Gateway source lives in **[`../agent`](../agent/)** in this repo (Node, `src/index.mjs`). From `agent/`:

```bash
export ELTPULSE_AGENT_TOKEN="…"
export ELTPULSE_CONTROL_PLANE_URL="https://app.eltpulse.dev"
node src/index.mjs
```

Use the **same** environment variables as Docker so the control plane sees a normal gateway.

## Option C — air-gapped / jump host

Same as Option A: run Docker on the jump host, set env to reach the control plane URL that is allowed from that network, and ensure TLS trust for your app’s certificate if you use a private CA.

## Smoke test

From any machine with `curl`:

```bash
curl -sfS -H "Authorization: Bearer $ELTPULSE_AGENT_TOKEN" \
  "${ELTPULSE_CONTROL_PLANE_URL%/}/api/agent/manifest" | head
```

If that succeeds, the local (or any) agent process using the same token can authenticate the same way.
