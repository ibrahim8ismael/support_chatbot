# Development

Local setup, scripts, tests, and conventions. Assumes macOS/Linux with Docker.

## Prerequisites

| Tool | Version |
| --- | --- |
| Node.js | 22 LTS+ |
| pnpm | 9+ (`corepack enable`) |
| Docker + Compose | current |
| git | current |

## Quick start

```bash
git clone <repo> && cd support-chatbot
pnpm install
cp .env.example apps/api/.env.local          # fill in the values you need
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm db:migrate
pnpm seed:admin -- --email admin@example.com   # creates the first admin, prints a password once
pnpm dev                                     # turbo: api on :3001, web on :3000
```

With no Chatwoot and no provider keys you can still: log into the dashboard, create a KB, upload documents (ingestion uses a deterministic **fake embedding provider** when `LLM_PROVIDER=mock`), ask questions (mock replies echo `I received: …`), and post simulated webhooks with `pnpm simulate:webhook` (see below).

## Scripts (root)

| Command | What it does |
| --- | --- |
| `pnpm dev` | run api + web with hot reload (turbo) |
| `pnpm build` | build all packages/apps |
| `pnpm lint` / `pnpm typecheck` | eslint + tsc across the monorepo |
| `pnpm test` | unit tests (all workspaces) |
| `pnpm test:e2e` | api e2e (testcontainers Postgres & Redis + mocked providers) |
| `pnpm db:migrate` / `pnpm db:generate` | apply / create migrations |
| `pnpm db:studio` | inspect the local DB |
| `pnpm evals` | run the RAG eval set through the real pipeline (mock provider by default; real providers cost money — see below) |
| `pnpm simulate:webhook` | send a captured Chatwoot payload to the local webhook |

## Environment

- `apps/api/.env.example` lists every variable ([reference](../operations/deployment.md#environment-variables)). Never commit real values.
- Local profiles: `LLM_PROVIDER=mock` (default — no external calls), or `openai`, `openrouter`, `gemini`, or `vertex` when you have keys in `.env.local` (real embeddings/replies; OpenRouter, Gemini and Vertex still use OpenAI for embeddings, so set `OPENAI_API_KEY` too). Vertex needs either `GOOGLE_VERTEX_API_KEY` (express mode) or `GOOGLE_VERTEX_PROJECT` + `GOOGLE_VERTEX_LOCATION` with Google ADC.
- The web app talks to the API via `NEXT_PUBLIC_API_URL`.

## Running evals

`pnpm evals` runs [`apps/api/evals`](../../apps/api/evals/README.md) — the T-108 eval set
and gates. It needs Postgres + Redis, migrations, and a seeded user; it then creates a
scratch `__eval__` knowledge base, ingests the corpus through the normal upload/queue
path, asks every case through `AgentService.ask()`, and prints per-topic + overall metrics:

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis
pnpm db:migrate && pnpm seed:admin -- --email admin@example.com
pnpm evals                              # provider from apps/api/.env.local
pnpm evals -- --topic=password-reset
pnpm evals -- --keep --verbose
```

The exit code is non-zero when a gate fails: retrieval ≥ 0.90, groundedness ≥ 0.95,
escalation ≥ 0.90, injection compliance = 1.00, case errors = 0. With
`LLM_PROVIDER=mock`, plumbing and retrieval invariants are exercised but groundedness
uses the mock judge (plumbing only) — run with a real provider before claiming a quality
number. Runs are written to `apps/api/evals/.results/` (gitignored);
`pnpm test` guards the dataset contract and gate math in CI.

## Testing strategy

| Layer | Tool | What it covers |
| --- | --- | --- |
| Unit | Vitest/Jest | chunking, filters (webhook matrix), threshold decisions, prompt assembly, metric calculations |
| Integration | SuperTest + testcontainers Postgres & Redis | module APIs against a real DB incl. pgvector, queue and cache behavior; Chatwoot HTTP calls mocked (nock/msw) |
| E2E (local) | webhook fixtures → queue → mocked models | full message flow: webhook in → decision → outbound call asserted |
| Contract | captured Chatwoot fixtures (anonymized) | catches payload drift when Chatwoot is upgraded |
| Evals (manual) | `pnpm evals` | retrieval, groundedness, escalation and injection gates through the real pipeline ([gates](../architecture/rag-pipeline.md#quality-eval-set--gates)) |

Rules of thumb: **no real model calls in CI** (mock provider); every bugfix that involved an answer decision adds a case to the eval set or a unit test — not just a Slack message.

## Testing with a live Chatwoot

1. Run your local Chatwoot (their official docker-compose) or use the shared staging one.
2. Expose your local API: `cloudflared tunnel --url http://localhost:3001` (or ngrok).
3. Create a dev Agent Bot (Settings → Bots) with webhook URL `https://<tunnel>/api/webhooks/chatwoot/<dev-secret>` and bind it to a test inbox (inbox → Bot Configuration).
4. Map the test inbox to a knowledge base, ensure the global `bot_enabled` switch is on, and send a message. Chatwoot should receive a fast webhook acknowledgement; the worker then stores the conversation, retrieves an answer, or posts a handoff.

Simulator (no Chatwoot at all): `pnpm simulate:webhook -- --conversation 812 --inbox 1` posts a sample `message_created` payload. It signs the request when `CHATWOOT_WEBHOOK_SIGNING_SECRET` is set. The event may be processed if the selected inbox is bound and the global switch is on, so use a test conversation/inbox. Wrong path secret → `404`.

## Dashboard UI (HeroUI)

The dashboard uses [HeroUI v3](https://heroui.com) on Tailwind CSS v4.
`@heroui/styles` is imported by `apps/web/app/globals.css`, `@tailwindcss/postcss`
compiles it, and components come from `@heroui/react`:

```tsx
import { Button, Card } from '@heroui/react';
```

HeroUI v3 needs no provider. Use Tailwind utilities for layout and HeroUI's
semantic tokens (`bg-surface`, `text-muted`, `border-border`) instead of raw hex
values; dark mode is the `.dark` class on `<html>`. Dashboard chrome (sidebar,
mobile drawer, header, theme toggle, account menu) lives in
`apps/web/components/dashboard-shell.tsx`. New screens should compose the same
primitives: `Card` for sections, `Table` for collections, `Select`/`TextField`
for filters and forms, `Alert`/`Spinner` for states.

## Conventions

- **Branches:** `feat/<topic>`, `fix/<topic>`, `docs/<topic>`; small PRs; squash merge.
- **Commits:** conventional commits (`feat(agent): …`, `fix(chatwoot): …`) — used for changelogs later.
- **TypeScript:** strict mode; no `any` in exported signatures; zod at every boundary (env, webhook, controller input, model output).
- **Package manager:** pnpm only — `packageManager` pinned in the root `package.json` (corepack); no npm/yarn lockfiles; CI installs with `pnpm install --frozen-lockfile`.
- **Outbound HTTP:** axios instances, one per integration, created in the owning module (timeout + retry + logging interceptors). Model provider calls go through the AI SDK — never axios.
- **Tests next to code** (`*.spec.ts`); e2e in `apps/api/test`.
- **Docs:** any PR that changes behavior updates the matching doc in `docs/` (README has the map). ADR for architectural decisions; [open-decisions.md](../open-decisions.md) status updated.

## Adding a new API module (checklist)

1. Create `apps/api/src/modules/<name>/` with `*.module.ts`, `*.service.ts`, controller (if it has endpoints), `dto/`.
2. Register in `app.module.ts`.
3. If it owns tables: add entities + migration; add a row to the module table in [repo-structure](../architecture/repo-structure.md).
4. If it has endpoints: update [rest-api.md](../api/rest-api.md) + role requirements.
5. Tests: 1 happy path + 1 failure per endpoint; unit tests for decision logic.
6. If it calls models or Chatwoot: go through `llm` / `chatwoot` services — never directly.

## Common tasks

| Task | Where |
| --- | --- |
| Add a tuning knob | settings table + typed accessor + doc row in [rag-pipeline](../architecture/rag-pipeline.md#tuning-knobs-where-they-live) |
| Change a prompt | edit the versioned file, run evals, note results in the PR, update prompt version constant |
| Add a webhook filter | filter matrix in [chatwoot.md](../integrations/chatwoot.md) + fixture test |
| Add an analytics metric | definition in [rest-api.md § definitions](../api/rest-api.md#metric-definitions-contract--do-not-silently-change) + calculation test |
