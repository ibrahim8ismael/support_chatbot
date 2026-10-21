# Support Agent

Self-hosted, open-source AI support agent. It answers customer messages that
arrive through **Chatwoot**, using **RAG over your own knowledge bases**, and
escalates to a human when it is not confident.

One repository, one API deployable, one dashboard deployable — a **modular
monolith** ([ADR-0001](docs/decisions/0001-modular-monolith.md)).

## Status (2026-10)

| Area                                                                        | State                                                                                                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard: auth, users, roles, audit log, analytics                         | ✅ working                                                                                                                                     |
| Knowledge bases: upload → parse (PDF/DOCX/TXT/MD) → chunk → embed → `ready` | ✅ working                                                                                                                                     |
| Retrieval, grounded answers, escalation decisions                           | ✅ working (sandbox + evals)                                                                                                                   |
| Chatwoot webhook → reply pipeline                                           | ✅ implemented; set the Chatwoot signing secret and complete staging/eval rollout before production ([details](docs/integrations/chatwoot.md)) |
| Real-model eval numbers                                                     | ⏳ need a real provider key (mock runs are plumbing-only)                                                                                      |

The `mock` LLM provider runs the whole app offline with deterministic replies
and no API keys — it is **dev/test-only**: production refuses to boot in mock
mode, no override.

## Setup guide: run your own support agent

### Requirements

- One host with Docker + Compose (4 vCPU / 8 GB is the starting point). TLS in
  front of the stack is handled by the bundled Caddy.
- An OpenAI API key is always required for embeddings (`text-embedding-3-small`,
  D3). Chat can run on OpenAI, OpenRouter, Google Gemini, or Google Vertex AI.
- Optional: a self-hosted Chatwoot instance. Configure its Agent Bot signing
  secret and validate a staging inbox before enabling production traffic.

### 1. Configure

```sh
git clone https://github.com/ibrahim8ismael/support_chatbot.git support-agent
cd support-agent
cp docker/.env.prod.example .env
```

Fill in `.env` — the API validates everything at boot and rejects placeholder
secrets, so mistakes surface immediately rather than at 3 AM:

| Variable                                         | Notes                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SITE_ADDRESS`, `APP_URL`, `NEXT_PUBLIC_API_URL` | dashboard hostname, e.g. `https://support.example.com` (`NEXT_PUBLIC_*` is baked into the web build; unset = the API is called on the dashboard's own origin) |
| `POSTGRES_PASSWORD` + `DATABASE_URL`             | use the same password in both                                                                                                                                 |
| `LLM_PROVIDER` + provider key                    | `openai`, `openrouter`, `gemini`, or `vertex`; embeddings always need `OPENAI_API_KEY`                                                                        |
| `COMPANY_NAME`                                   | your company name — fills the answer prompt; the scaffold default is rejected in production                                                                   |
| `CHATWOOT_*`                                     | follow the [Chatwoot setup](#connect-chatwoot) below; keep these credentials in `.env` only                                                                   |

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
2. **Sandbox** — select document KBs, ask representative customer questions,
   and review the retrieved sources before connecting an inbox.
3. **Users** — create accounts for the support team (`admin` / `editor` / `viewer`).
4. **Settings** — tune thresholds and prompts, use the global `bot_enabled` kill
   switch, and run the LLM health check.
5. **Bindings** — map Chatwoot inboxes to knowledge bases. Enable the global
   bot switch only after validating the configuration and a staging inbox.

### Connect Chatwoot

The integration uses an Agent Bot webhook. Set these values in the repo-root
`.env` used by Docker Compose; never commit real tokens or secrets:

```dotenv
CHATWOOT_BASE_URL=https://chatwoot.example.com
CHATWOOT_ACCOUNT_ID=1
CHATWOOT_BOT_TOKEN=<Agent Bot API token>
CHATWOOT_WEBHOOK_SECRET=<random URL secret>
CHATWOOT_WEBHOOK_SIGNING_SECRET=<Agent Bot signing secret>
# Optional: a Chatwoot user API token for inbox-name discovery in the dashboard.
CHATWOOT_ACCOUNT_API_TOKEN=
```

`CHATWOOT_BOT_TOKEN` is the Agent Bot API token used to send replies, notes,
and labels. `CHATWOOT_WEBHOOK_SIGNING_SECRET` is the signing secret shown in
Chatwoot's Agent Bot settings. `CHATWOOT_WEBHOOK_SECRET` is a separate secret
generated for this app's callback URL. Generate it with
`openssl rand -hex 32`; do not reuse the Chatwoot signing secret. The optional
account API token enables inbox-name discovery; without it, enter the numeric
inbox ID manually. For older Chatwoot versions that do not sign Agent Bot
webhooks, leave the signing secret empty; the callback URL secret is still
checked.

Create an Agent Bot in Chatwoot and set its callback URL to:

```text
https://<public-api-host>/api/webhooks/chatwoot/<CHATWOOT_WEBHOOK_SECRET>
```

Chatwoot must be able to reach this API URL. For local development, use a
reachable HTTPS tunnel instead of `localhost`. Copy the Agent Bot token and
signing secret into `.env`, then recreate the API container so it reads the
new values:

```sh
docker compose --env-file .env -f docker/docker-compose.prod.yml up -d --no-deps api
```

In Chatwoot, bind the Agent Bot to a **test inbox**. In the dashboard, add an
inbox binding and select at least one knowledge base whose documents are ready.
Keep the binding disabled while configuring it. Confirm the global `bot_enabled`
setting is on, then enable the test inbox binding and send a message from a
customer/contact. Confirm the reply or handoff in Chatwoot and the conversation
explorer before connecting other inboxes. The conversation explorer receives
messages delivered after connection; this integration does not import old
Chatwoot conversations or message history.

See the [Chatwoot integration guide](docs/integrations/chatwoot.md) for the
webhook signature, event behavior, and operational limitations. Validate the
setup against a test inbox and your deployed Chatwoot version before enabling
production traffic.

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

| Command                                                   | What it does                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev` / `pnpm build`                                 | run / build all workspaces (turbo)                             |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`              | quality gates across the monorepo                              |
| `pnpm test:e2e`                                           | api e2e tests                                                  |
| `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:studio` | Drizzle migrations                                             |
| `pnpm seed:admin`                                         | create/update an admin, prints a password once                 |
| `pnpm evals`                                              | RAG eval suite (meaningful only with a real provider key)      |
| `pnpm simulate:webhook`                                   | post a synthetic Chatwoot webhook (requires the API and Redis) |

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
- [Chatwoot integration](docs/integrations/chatwoot.md) — setup, webhook contract, and current rollout status
- [Deployment](docs/operations/deployment.md) · [Security](docs/operations/security.md)
- [Build plan](docs/contributing/build-plan.md) — ticket-by-ticket status
- [CHANGELOG.md](CHANGELOG.md)
