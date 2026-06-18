# eltPulse gateway — published as ghcr.io/eltpulsehq/gateway:latest
#
# Lightweight polling process only — no pipeline runtimes needed here.
# Pipeline code runs in ghcr.io/eltpulsehq/gateway-worker containers/jobs
# launched by the docker / kubernetes / ecs executors.

FROM node:20-slim

WORKDIR /app
COPY lib ./lib
COPY gateway/package.json ./gateway/package.json
COPY gateway/src ./gateway/src

WORKDIR /app/gateway
ENV NODE_ENV=production

USER node
CMD ["node", "src/index.mjs"]
