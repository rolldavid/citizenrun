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

FROM fetch AS prod-deps
COPY . .
# `pnpm fetch` put every package of the lockfile in node_modules; reinstalling into an empty one
# from the store keeps only this service's production dependencies (D-829).
RUN rm -rf node_modules && pnpm install --frozen-lockfile --offline --prod --filter @citizenrun/worker

# The operating-system layer of the deployed image.
FROM ${NODE_IMAGE} AS system
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libjemalloc2 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/lib/$(uname -m)-linux-gnu/libjemalloc.so.2 /usr/local/lib/libjemalloc.so.2 \
 && ffmpeg -version && ffprobe -version \
 && ffmpeg -hide_banner -filters | grep -q zscale
ENV LD_PRELOAD=/usr/local/lib/libjemalloc.so.2

# The deployed image. It stays the last stage, so a build without --target (Railway's) produces it.
FROM system AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/packages/cards/assets/fonts ./packages/cards/assets/fonts
USER node
CMD ["node", "--enable-source-maps", "apps/worker/dist/main.js"]
