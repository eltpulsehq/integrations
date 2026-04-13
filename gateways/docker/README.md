# Docker / Docker Compose

Run the published gateway image on a host with Docker.

## Quick start

1. Copy [`.env.example`](.env.example) to `.env` and set real values (do not commit `.env`).
2. From this directory:

```bash
docker compose up -d
```

3. Logs: `docker compose logs -f gateway`

## Single `docker run` (no Compose)

```bash
docker run -d --name eltpulse-gateway --restart unless-stopped \
  -e ELTPULSE_AGENT_TOKEN="$ELTPULSE_AGENT_TOKEN" \
  -e ELTPULSE_CONTROL_PLANE_URL="$ELTPULSE_CONTROL_PLANE_URL" \
  ghcr.io/eltpulsehq/agent:latest
```

## Egress

The process needs outbound TLS to `ELTPULSE_CONTROL_PLANE_URL` and to any sources/warehouses you use from eltPulse. No inbound access from eltPulse is required.
