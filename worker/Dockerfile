# eltPulse pipeline worker — published as ghcr.io/eltpulsehq/gateway-worker:latest
#
# Short-lived container: one per pipeline run. Executes dlt/sling, PATCHes
# logs/telemetry/status to the control plane, then exits.

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://install.slingdata.io | bash \
  && sling --version

RUN pip3 install --no-cache-dir --break-system-packages \
    "dlt[bigquery,redshift,snowflake,duckdb,filesystem,postgres]" \
    "psutil>=6.0.0"

WORKDIR /app
COPY lib ./lib
COPY worker/package.json ./worker/package.json
COPY worker/src ./worker/src

WORKDIR /app/worker
ENV NODE_ENV=production
ENV ELTPULSE_WORK_DIR=/tmp/eltpulse

USER node
CMD ["node", "src/index.mjs"]
