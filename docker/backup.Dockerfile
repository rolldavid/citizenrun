# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=12.21.0
ENV CI=true
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# Dependency layer: changes only when the lockfile or workspace settings change.
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline --filter citizenrun --filter "@citizenrun/worker..."
RUN pnpm build:worker

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && pg_dump --version | grep -q ' 17\.'
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/worker/dist/backup.js /app/apps/worker/dist/backup.js.map ./apps/worker/dist/
USER node
CMD ["node", "--enable-source-maps", "apps/worker/dist/backup.js"]
