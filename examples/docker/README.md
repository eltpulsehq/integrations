# Docker gateway

Run the published agent image with a named gateway token from the eltPulse app (**Gateway** page).

## Prerequisites

- Docker
- `ELTPULSE_AGENT_TOKEN` — Bearer secret (do not commit)
- `ELTPULSE_CONTROL_PLANE_URL` — your app origin, e.g. `https://app.eltpulse.dev`

## Run

```bash
docker run -d \
  --name eltpulse-gateway \
  --restart unless-stopped \
  -e ELTPULSE_AGENT_TOKEN="$ELTPULSE_AGENT_TOKEN" \
  -e ELTPULSE_CONTROL_PLANE_URL="$ELTPULSE_CONTROL_PLANE_URL" \
  ghcr.io/eltpulsehq/agent:latest
```

Copy from [`.env.example`](.env.example), fill values locally, then:

```bash
set -a && source .env && set +a
docker run -d --name eltpulse-gateway --restart unless-stopped \
  -e ELTPULSE_AGENT_TOKEN -e ELTPULSE_CONTROL_PLANE_URL \
  ghcr.io/eltpulsehq/agent:latest
```

## Egress

The container only needs **outbound HTTPS** to the control plane and to any sources/warehouses you configure in eltPulse. No inbound rules for eltPulse.
