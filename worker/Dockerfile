# eltPulse pipeline worker — published as ghcr.io/eltpulsehq/gateway-worker:latest
#
# Short-lived container: one per pipeline run. Receives run context via env
# vars, executes the pipeline (dlt or sling), PATCHes logs/status back to
# the control plane, then exits.

FROM node:20-slim

# ── System deps ────────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── sling ──────────────────────────────────────────────────────────────────────
RUN curl -fsSL https://install.slingdata.io | bash \
  && sling --version

# ── dlt ───────────────────────────────────────────────────────────────────────
RUN pip3 install --no-cache-dir --break-system-packages \
    "dlt[bigquery,redshift,snowflake,duckdb,filesystem,postgres]"

# ── Worker app ────────────────────────────────────────────────────────────────
WORKDIR /app
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV ELTPULSE_WORK_DIR=/tmp/eltpulse

USER node
CMD ["node", "src/index.mjs"]
