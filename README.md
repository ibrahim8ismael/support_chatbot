# Support Agent

Self-hosted, open-source AI support agent. It answers customer messages that
arrive through **Chatwoot**, using **RAG over your own knowledge bases**, and
escalates to a human when it is not confident.

One repository, one API deployable, one dashboard deployable — a **modular
monolith** ([ADR-0001](docs/decisions/0001-modular-monolith.md)).

## Status (2026-10)

| Area                                                                        | State                                                                                                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Dashboard: auth, users, roles, audit log, analytics                         | ✅ working                                                                                                                 |
| Knowledge bases: upload → parse (PDF/DOCX/TXT/MD) → chunk → embed → `ready` | ✅ working                                                                                                                 |
| Retrieval, grounded answers, escalation decisions                           | ✅ working (playground + evals)                                                                                            |
| Chatwoot webhook → reply pipeline                                           | 🚧 stub — the webhook answers `501`; tickets T-201…T-204 ([details](docs/integrations/chatwoot.md#current-status-2026-10)) |
| Real-model eval numbers                                                     | ⏳ need an OpenAI/OpenRouter key (mock runs are plumbing-only)                                                             |

The `mock` LLM provider runs the whole app offline with deterministic replies
and no API keys — it is **dev/test-only**: production refuses to boot in mock
mode, no override.

## Setup guide: run your own support agent

### Requirements

- One host with Docker + Compose (4 vCPU / 8 GB is the starting point). TLS in
  front of the stack is handled by the bundled Caddy.
- An OpenAI API key and/or an OpenRouter key — chat goes to either, embeddings
  always to OpenAI (`text-embedding-3-small`).
- Optional: a self-hosted Chatwoot instance. **Do not bind a production inbox
  yet** — the reply pipeline is still a stub (see Status).

### 1. Configure

```sh
git clone https://github.com/ibrahim8ismael/support_chatbot.git support-agent
cd support-agent
cp docker/.env.prod.example .env
```

Fill in `.env` — the API validates everything at boot and rejects placeholder
secrets, so mistakes surface immediately rather than at 3 AM:

| Variable                                                    | Notes                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_ADDRESS`, `APP_URL`, `NEXT_PUBLIC_API_URL`            | dashboard hostname, e.g. `https://support.example.com` (`NEXT_PUBLIC_*` is baked into the web build; unset = the API is called on the dashboard's own origin) |
| `POSTGRES_PASSWORD` + `DATABASE_URL`                        | use the same password in both                                                                                                                                 |
| `LLM_PROVIDER` + `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) | `openai` or `openrouter`                                                                                                                                      |
| `COMPANY_NAME`                                              | your company name — fills the answer prompt; the scaffold default is rejected in production                                                                   |
| `CHATWOOT_*`                                                | optional until the pipeline lands — see the [Chatwoot doc](docs/integrations/chatwoot.md)                                                                     |

The full list with defaults and the secret-rotation runbook lives in
[docs/operations/deployment.md](docs/operations/deployment.md).

### 2. Start the stack

```sh
docker compose --env-file .env -f docker/docker-compose.prod.yml up -d --build
```

Compose applies the Drizzle migrations in a one-shot `migrate` service first,
then starts the API (REST + BullMQ workers), the dashboard and Caddy.

### 3. Create the first admin

```sh
docker compose --env-file .env -f docker/docker-compose.prod.yml \
  run --rm api node dist/cli/seed-admin.js --email you@company.com
```

A random password is printed once. Trust the internal CA certificate, then log
in at your `SITE_ADDRESS` ([deployment § TLS](docs/operations/deployment.md)).

### 4. Teach it your company

1. **Knowledge bases → add KB** — upload your handbooks/FAQs (PDF, DOCX, TXT, MD;
   ≤ 20 MB, ≤ 500 pages) and wait for each document to reach `ready`.
2. **Playground** — pick the KB(s), ask real customer questions, inspect the
   retrieved chunks, scores, and the grounded answer before anything is public.
3. **Users** — create accounts for the support team (`admin` / `editor` / `viewer`).
4. **Settings** — tune thresholds and prompts, use the global `bot_enabled` kill
   switch, and run the LLM health check.
5. **Bindings** — map Chatwoot inbox ids to knowledge bases (takes effect when
   the Chatwoot pipeline lands; every switch has a per-inbox kill switch).

Operational extras: [weekly unanswered digest](docs/operations/deployment.md),
[backups & restore](docs/operations/deployment.md), [security model](docs/operations/security.md),
[NFR smoke test](docs/operations/deployment.md).

## Local development

```sh
pnpm install                                   # Node ≥ 22, pnpm ≥ 9
cp .env.example apps/api/.env.local            # LLM_PROVIDER=mock works without keys
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm db:migrate
pnpm seed:admin -- --email admin@example.com   # prints a password once
pnpm dev                                       # api :3001, web :3000
```

With `LLM_PROVIDER=mock` you can exercise the entire app offline: KB ingestion
(fake embeddings), playground questions, dashboard, analytics, and simulated
webhooks (`pnpm simulate:webhook`). Details and rules of thumb:
[docs/contributing/development.md](docs/contributing/development.md).

## Scripts (root)

| Command                                                   | What it does                                                |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm dev` / `pnpm build`                                 | run / build all workspaces (turbo)                          |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`              | quality gates across the monorepo                           |
| `pnpm test:e2e`                                           | api e2e tests                                               |
| `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:studio` | Drizzle migrations                                          |
| `pnpm seed:admin`                                         | create/update an admin, prints a password once              |
| `pnpm evals`                                              | RAG eval suite (meaningful only with a real provider key)   |
| `pnpm simulate:webhook`                                   | post a synthetic Chatwoot webhook (answers 501 until T-201) |

## Layout

```
apps/api        NestJS modular-monolith backend (modules: docs/architecture/repo-structure.md)
apps/web        Next.js dashboard
packages/shared Zod schemas, types, constants shared by api & web
packages/config tsconfig / eslint / prettier presets
docker          docker-compose (dev + prod)
docs            design source of truth — start at docs/README.md
```

## Docs

- [docs/README.md](docs/README.md) — architecture, ADRs, operations, contributing
- [Chatwoot integration](docs/integrations/chatwoot.md) — target contract + current stub status
- [Deployment](docs/operations/deployment.md) · [Security](docs/operations/security.md)
- [Build plan](docs/contributing/build-plan.md) — ticket-by-ticket status
- [CHANGELOG.md](CHANGELOG.md)
