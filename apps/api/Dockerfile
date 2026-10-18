# syntax=docker/dockerfile:1
# Build context: repository root (see docker/docker-compose.prod.yml)

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm turbo run build --filter=api

FROM build AS prod-deps
# --legacy: pnpm 10's default deploy path requires inject-workspace-packages
# (which would change dev install semantics) — the legacy deploy copies the
# package plus its prod deps, including the built @support-agent/shared.
RUN pnpm --filter api deploy --prod --legacy /app

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app ./
# Uploads volume mountpoint — owned by the app user, so the named volume
# initializes writable (UPLOAD_DIR=/data/uploads in docker-compose.prod.yml).
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3001
# pnpm deploy lands the package as-is (files: dist), so the entrypoint is
# dist/main.js — the migrate/seed CLIs live beside it under dist/cli/.
CMD ["node", "dist/main.js"]
