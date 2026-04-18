# eltPulse gateway — published as ghcr.io/eltpulsehq/gateway:latest
#
# Lightweight polling process only — no pipeline runtimes needed here.
# Pipeline code runs in ghcr.io/eltpulsehq/gateway-worker containers/jobs
# launched by the docker / kubernetes / ecs executors.
#
# For the "local" executor (dev/laptop), use the worker image instead, or
# install python3 and sling on the host and run the gateway directly with Node.

FROM node:20-slim

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production

USER node
CMD ["node", "src/index.mjs"]
