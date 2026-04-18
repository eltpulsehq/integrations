# eltPulse gateway — published as ghcr.io/eltpulsehq/gateway:latest
#
# Includes:
#   - Node 20 (gateway polling process)
#   - Python 3 + dlt with common destination extras
#   - sling binary (database-to-database ELT)
#
# Set ELTPULSE_EXECUTE_RUNS=1 to enable actual run execution.
# Default off so connecting to prod never mutates runs by accident.

FROM node:20-slim

# ── System deps ────────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── sling ──────────────────────────────────────────────────────────────────────
RUN curl -fsSL https://install.slingdata.io | bash \
  && sling --version

# ── dlt ───────────────────────────────────────────────────────────────────────
# Common destination extras — add more as needed (mssql, clickhouse, etc.)
RUN pip3 install --no-cache-dir --break-system-packages \
    "dlt[bigquery,redshift,snowflake,duckdb,filesystem,postgres]"

# ── Gateway ────────────────────────────────────────────────────────────────────
WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV ELTPULSE_WORK_DIR=/tmp/eltpulse

USER node
CMD ["node", "src/index.mjs"]
