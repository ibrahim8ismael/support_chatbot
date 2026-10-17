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
RUN pnpm --filter api deploy --prod /app

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app ./
USER node
EXPOSE 3001
CMD ["node", "main.js"]
