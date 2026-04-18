# Local gateway (laptop / dev machine)

The **gateway** is the same process everywhere. On your machine you usually run it as a **container** (simplest) or **from source** when you are developing the gateway itself.

## Option A — Docker (recommended for local)

Use **[`../docker`](../docker/)**: `docker compose` with `.env` holding `ELTPULSE_AGENT_TOKEN` and `ELTPULSE_CONTROL_PLANE_URL`. No Kubernetes or cloud required.

That is the supported local path for eltPulse customers: one long-lived container with outbound HTTPS to the app.

## Option B — Run from source (gateway developers)

Gateway source lives in **[`../gateway`](../gateway/)** in this repo (Node, `src/index.mjs`). From `gateway/`:

```bash
export ELTPULSE_AGENT_TOKEN="…"
export ELTPULSE_CONTROL_PLANE_URL="https://app.eltpulse.dev"
export ELTPULSE_EXECUTE_RUNS=1
node src/index.mjs
```

The `local` runner (subprocess inside the gateway process) is used automatically — no extra configuration needed.

Use the **same** environment variables as Docker so the control plane authenticates the same way.

## Option C — air-gapped / jump host

Same as Option A: run Docker on the jump host, set env to reach the control plane URL that is allowed from that network, and ensure TLS trust for your app’s certificate if you use a private CA.

## Smoke test

From any machine with `curl`:

```bash
curl -sfS -H "Authorization: Bearer $ELTPULSE_AGENT_TOKEN" \
  "${ELTPULSE_CONTROL_PLANE_URL%/}/api/agent/manifest" | head
```

If that succeeds, the gateway process using the same token can authenticate the same way.
