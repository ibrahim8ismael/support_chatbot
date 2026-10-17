# Support Agent

Internal AI support agent. It answers customer messages that arrive through our self-hosted **Chatwoot**, using **RAG over company knowledge bases**, and escalates to a human when it is not confident.

One repository, one API deployable, one dashboard deployable — a **modular monolith** ([ADR-0001](docs/decisions/0001-modular-monolith.md)).

## Layout

```
apps/api        NestJS modular-monolith backend (modules: docs/architecture/repo-structure.md)
apps/web        Next.js dashboard
packages/shared Zod schemas, types, constants shared by api & web
packages/config tsconfig / eslint / prettier presets
docker          docker-compose (dev + prod)
docs            design source of truth — start at docs/README.md
```

## Quick start (local)

```bash
pnpm install
cp .env.example apps/api/.env.local          # LLM_PROVIDER=mock works without keys
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm db:migrate
pnpm dev                                     # api on :3001, web on :3000
```

## Scripts (root)

| Command                                                   | What it does                                       |
| --------------------------------------------------------- | -------------------------------------------------- |
| `pnpm dev` / `pnpm build`                                 | run / build all workspaces (turbo)                 |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`              | quality gates across the monorepo                  |
| `pnpm test:e2e`                                           | api e2e tests                                      |
| `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:studio` | Drizzle migrations                                 |
| `pnpm simulate:webhook`                                   | post a synthetic Chatwoot webhook to the local API |

Full details: [docs/contributing/development.md](docs/contributing/development.md).
Release notes: [CHANGELOG.md](CHANGELOG.md).
