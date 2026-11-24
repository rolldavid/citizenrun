# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.65.1-noble

FROM ${NODE_IMAGE} AS node

FROM ${PLAYWRIGHT_IMAGE} AS e2e
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && node --version
ARG PNPM_VERSION=12.21.0
ENV CI=true
RUN npm install -g pnpm@${PNPM_VERSION}
# scripts/e2e-stack.ts drops and creates the stack's database with psql, which the Playwright image lacks.
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline --filter citizenrun --filter "@citizenrun/api..." --filter "@citizenrun/worker..." --filter "@citizenrun/mobile..."
RUN pnpm build:web && pnpm build:api && pnpm build:worker
CMD ["pnpm", "e2e:web"]
