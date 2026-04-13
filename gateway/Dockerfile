# eltPulse gateway — published as ghcr.io/eltpulsehq/gateway:latest from this repo.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production

USER node
CMD ["node", "src/index.mjs"]
