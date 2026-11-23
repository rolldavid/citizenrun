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

# Build layer: web export and service bundles.
FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline --filter citizenrun --filter "@citizenrun/api..." --filter "@citizenrun/mobile..."
RUN pnpm build:web
RUN pnpm build:api

# Production dependencies of the API only (the native externals resolve from here).
FROM fetch AS prod-deps
COPY . .
RUN pnpm install --frozen-lockfile --offline --prod --filter @citizenrun/api

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/mobile/dist ./apps/mobile/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/packages/cards/assets/fonts ./packages/cards/assets/fonts
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "apps/api/dist/server.js"]
