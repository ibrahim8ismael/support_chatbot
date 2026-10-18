# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/) — curated entries are added
here in the same PR as user-visible changes. Ticket IDs refer to the
[build plan](docs/contributing/build-plan.md).

## [Unreleased]

### Added

- **Monorepo scaffold** (T-000): pnpm workspaces + Turborepo; `apps/api` (NestJS 12
  modular monolith with the 14 modules from the repo-structure doc), `apps/web`
  (Next.js 16 App Router: login + dashboard routes), `packages/shared` (zod schemas,
  domain enums, queue/Redis constants), `packages/config` (tsconfig / eslint / prettier
  presets).
- **API foundations**: zod-validated environment (fail fast), pino JSON logger with
  secret redaction, Drizzle + migration plumbing, BullMQ/Redis infra (db 0 queue /
  db 1 cache), `GET /health` contract, and the
  `POST /api/webhooks/chatwoot/:secret` edge (bad secret → 404).
- **Local environment**: docker compose for Postgres (pgvector) + Redis (AOF,
  noeviction), multistage Dockerfiles for api/web, `pnpm simulate:webhook` script,
  repo-wide `lint` / `typecheck` / `test` / `build` via Turborepo.
- **Testing**: Vitest + SWC setup for `apps/api` (Nest 12 is ESM-only) with unit tests
  for env validation and the health contract.
- **Database schema** (T-101): all 11 tables from
  [data-model](docs/architecture/data-model.md) in their owning modules (users,
  sessions, knowledge_bases, documents, chunks, inbox_bindings, conversations,
  messages, answer_events, audit_logs, settings) with the first forward-only
  migration; `chunks.embedding vector(1536)` with an HNSW
  (`vector_cosine_ops`, m=16, ef_construction=64) index, case-insensitive
  `citext` emails, and the `chatwoot_message_id` dedupe key. Closes D3
  (`text-embedding-3-small`, 1536) and D6 (Drizzle).
- **Auth skeleton** (T-005): argon2id logins (`@node-rs/argon2`), server-side `sessions`
  with an httpOnly/sameSite=lax sliding 7-day cookie, `POST /auth/login`,
  `POST /auth/logout`, `GET /auth/me`, global `AuthGuard` + `RolesGuard` (default
  admin; `@Public()` on health/webhook/login/logout), per-IP (10/60 s) + per-account
  (exponential delay, 15-min lock after 8 failures) throttling counters in Redis,
  `pnpm seed:admin` CLI, zod body validation pipe (`ZodBodyPipe`), and a login page
  wired to the API. Closes D4 (local email + password).
- **Conversations module** (T-004): idempotent conversation upsert by Chatwoot ids,
  message dedupe (`ON CONFLICT DO NOTHING` on `chatwoot_message_id`) with
  `last_message_at` bumps, oldest→newest context reads (private notes excluded by
  default), and `bot_state` transitions. `infra` gains `LockService` (`SET NX PX` +
  watchdog renewal, token-checked release) for per-conversation serialization.
- **LLM module** (T-102): one model-access layer behind ADR-0005 — `embed()` (batched,
  order-preserving, Redis embedding cache `emb:v1:{model}:sha256(text)` with a 30-day
  TTL per [caching](docs/architecture/caching.md)), `generateReply()` (non-streamed),
  and `classify()` (typed zod output). `LLM_PROVIDER=mock` ships a deterministic
  feature-hash embedding model (1536 dims, unit-length) and an echo chat model
  ("I received: …" for the M0 loop) so dev and CI need no keys; real providers landed
  with D2 (see the real-provider entry below). Shared `EMBEDDING_DIMENSIONS`
  constant now backs the `chunks.embedding` column type.
- **Settings module** (T-205): typed runtime knobs (`bot_enabled` kill switch, prompt,
  fallback message, retrieval thresholds/top-k/context, reply cap, model ids) stored as
  overrides over documented defaults; reads merged and cached in Redis (`settings:v1`,
  60 s, busted on write), writes are editor/admin partial updates validated per key
  (strict keys + ranges, 400 with field details). `GET /settings`, `PUT /settings`, and
  an admin `GET /settings/health-llm` embed+generate smoke check (503 on provider
  failure). The system prompt defaults to the versioned
  `apps/api/src/modules/agent/prompts/answer.v1.ts`; audit writes land with T-301.
- **Bindings module** (T-206): `GET /bindings` + full-state
  `PUT /bindings/:chatwootInboxId` (editor/admin) over `inbox_bindings`, with strict
  uuid-array validation, `display_name` preserved for the Chatwoot sync, and
  `getBoundKbIdsForInbox()` cached per inbox (`bind:v1:*`, 60 s + bust on write).
  Empty `kbIds` and `enabled=false` both read as "bot off here".
- **Knowledge base module** (T-103): KB CRUD (`GET/POST/PATCH/DELETE /knowledge-bases`)
  and the document lifecycle (`/knowledge-bases/:id/documents`, `/documents/:id`).
  Summaries carry document counts + per-status totals; uploads are sniffed by content
  (PDF magic, DOCX zip container, UTF-8 text), capped at 20 MB, deduplicated per KB
  by sha256, stored in `UPLOAD_DIR` under generated names, and enqueued on
  `ingest-document`. KB hard delete refuses while an inbox is bound; document delete
  cascades chunks and bumps the `kb:{id}:version` counter. Closes D9 (local Docker
  volume).
- **Ingestion pipeline** (T-104): the `ingest-document` worker runs inside the API
  process (BullMQ, concurrency 2): parse (pdfjs, mammoth, TXT/MD) → clean (repeated
  header/footer stripping, de-hyphenation) → chunk (~700 tokens with ~100-token
  overlap, `heading`/`page` metadata, heading context for mid-section chunks) →
  embed in batches of 100 with 3 retries → transactional chunk replace under a
  Postgres advisory lock. Documents flip to `ready` with `chunk_count`, or to
  `failed` with a readable `error` after the final attempt; duplicate deliveries
  are no-ops. Mock-embedding e2e runs on checked-in PDF/DOCX fixtures.
- **Retrieval module** (T-105): `retrieve(query, kbIds, opts)` — embed (via `llm`,
  embedding cache) → pgvector cosine top-k over `chunks` (HNSW) → threshold + top-k
  resolved from settings with per-call overrides. Results are cached as
  `ret:v1:{kbId=version,…}:sha256(query)` for 15 minutes, so re-ingesting or
  deleting a document invalidates automatically; cache failures degrade to uncached
  searches. `POST /knowledge-bases/:id/search` (any signed-in role) exposes the path
  with a per-request trace (timings, best score, cache hit).
- **Agent core / playground** (T-106): `AgentService.ask()` runs the answer path —
  deterministic query build (message + recent customer turns while referential) →
  retrieval → threshold gate (nothing grounded → fallback message, escalated, no
  generation) → versioned prompt (`settings.system_prompt`, seeded from the
  `answer.v1` file: grounding rules, language matching, chunks as delimited `<kb>`
  data) → `generateReply` → output guard (length cap, internals/filename blocklist,
  URLs must come from the knowledge; a violation escalates instead of answering).
  Results carry grounded chunks + scores, token usage, latency split, model, and
  prompt version. `POST /playground/ask` (any signed-in role) exposes it for
  dashboard tuning; `COMPANY_NAME` env fills the prompt's `{{company_name}}`.
- **Dashboard: KB management + playground** (T-107): `/knowledge-bases` lists and
  creates KBs, shows per-document ingestion status (2.5 s polling while a job runs,
  reprocess/delete actions, failure reasons) and uploads PDF/DOCX/TXT/MD files with
  client-side pre-checks that mirror the API contract. `/playground` asks the real
  answer path against selected KBs and shows the full trace: answer or escalation
  (low_score / guard), grounded chunks with scores and source labels, latency,
  tokens, model, and prompt version. Session cookies keep the two apps wired; 401s
  bounce to `/login`. `apps/web` gains vitest with tests for the request-building
  and upload-validation logic.
- **Real LLM providers** (T-102, D2 closed): `LLM_PROVIDER=openai` wires OpenAI chat
  (`CHAT_MODEL`, default `gpt-4.1-mini`) + embeddings (`text-embedding-3-small`);
  `LLM_PROVIDER=openrouter` routes chat through OpenRouter (`@ai-sdk/openai-compatible`,
  any `vendor/model` id) while embeddings stay with OpenAI (D3). Model ids are
  provider-qualified (`openai:…` / `openrouter:…`) so the embedding cache and
  `answer_events` never mix models; missing keys and unknown providers fail fast at
  boot (`ANTHROPIC_API_KEY` / `SELF_HOSTED_BASE_URL` are gone — a third carrier would
  be a new factory case, not an env var).
- **RAG evals** (T-108): `apps/api/evals/` — 3 launch topics × 20 cases (answerable,
  must-escalate, injection) over a synthetic 10-document corpus, and `pnpm evals`, a
  runner that ingests the corpus through the real upload → queue → worker pipeline into
  a scratch KB, asks every case through `AgentService.ask()`, judges groundedness, and
  gates the run (retrieval ≥ 0.90, groundedness ≥ 0.95, escalation ≥ 0.90, injection =
  1.00, zero case errors). Results are written to `evals/.results/` with deltas against
  the previous run. CI specs cover the dataset contract, mock-embedding retrieval
  invariants, and gate math; under `LLM_PROVIDER=mock` the groundedness gate is a
  plumbing check, so real quality numbers need a configured provider key.
- **Event + audit writers** (T-301): `AnalyticsService` owns both write paths —
  `recordAnswerEvent()` (one row per answer attempt: query, top-k/score, retrieved chunk
  ids, latency breakdown, models, tokens, outcome) and `recordAuditLog()` (actor, action,
  entity, context). Both are best-effort: a failed insert is logged, never thrown.
  Wired into the agent (when the caller passes conversation context), auth (login
  success/failure with a reason, logout), KB and document create/update/upload/
  reprocess/delete, binding upserts (per-inbox kill switch) and settings updates
  (before/after diff per key). `ANSWER_OUTCOMES` gains `escalated_guard`; `created_at`
  on both tables is the retention key for the T-403 cleanup.
- **Analytics API + screen** (T-302): `GET /analytics/overview`, `/analytics/timeseries`
  and `/analytics/unanswered` implement the metric definitions contract in
  [rest-api](docs/api/rest-api.md) — `[from, to)` ranges (default: last 7 days), optional
  `inboxId`, UTC gap-free buckets (`interval=day|week|month`), deflection qualified by "no
  human agent message within 24 h". Unanswered questions are escalation rows in range,
  clustered by token similarity, and the endpoint is admin-only because it exposes
  customer question text ([security](docs/operations/security.md) § 4). The `/analytics`
  dashboard renders the aggregates as cards, a dependency-free bar chart, and the top
  unanswered list, with range/interval/inbox filters.
- **Conversation explorer** (T-303): `GET /conversations` lists conversations with
  `inboxId`/`botState`/`from`/`to` filters on `last_message_at` (half-open), `limit`/
  `offset` paging and a window total; `GET /conversations/:id` returns the thread
  oldest → newest (private notes flagged) plus the answer-event diagnostics. Answer
  events carry customer query text and cited chunks, so they are admin-only — other
  roles get the thread with `answerEventsRestricted: true`
  ([security](docs/operations/security.md) § 4). The `/conversations` screen adds a
  filter bar, a paged list and the diagnostics panel.
- **Admin UIs + users/audit APIs** (T-304): `GET/POST /users`, `PATCH /users/:id` and
  `POST /users/:id/password` (admin-only) manage accounts — duplicate emails are 409s,
  and deactivation or a password reset revokes the target's sessions
  ([security](docs/operations/security.md) § Session hygiene); every change writes a
  `users.*` audit row. `GET /audit-logs` (admin-only) returns the trail with the acting
  user's email, filters (`userId`, exact `action`, half-open `from`/`to`) and paging.
  The web app now ships working `/bindings` (KB multi-select + per-inbox kill switch)
  and `/settings` (typed form + admin LLM health check) screens plus new admin-only
  `/users` and `/audit` screens; other roles see inline 403 notes.
- **Weekly digest cron** (T-305): the first repeatable BullMQ job — `DigestScheduler`
  upserts the Monday 09:00 UTC `weekly-digest` schedule on the `analytics-followup`
  queue at every boot (idempotent) and `DigestWorker` clusters the trailing week with
  the `/analytics/unanswered` contract, posting a Slack-compatible `{"text": …}` to
  `DIGEST_WEBHOOK_URL` (unset → logged; failures retried with backoff and kept on the
  queue). No host cron — [deployment](docs/operations/deployment.md#scheduled-jobs).
- **Production deploy drill** (T-401): the prod compose is now a real TLS stack —
  Caddy fronts web+api (`docker/Caddyfile`; internal CA by default, `SITE_ADDRESS`
  picks the host), only 80/443 are published, runtime images are digest-pinned,
  uploads get a named volume, and a one-shot `migrate` of the api image applies
  Drizzle migrations before `api` starts. The api image carries
  `dist/cli/migrate.js` and `dist/cli/seed-admin.js` for the host runbook
  (migration SQL ships in `dist` via nest-cli assets), `docker/.env.prod.example`
  is the host template, and CI builds both Dockerfiles on every change. Drill
  findings fixed en route: pnpm 10 refuses `deploy` without `--legacy`, the api
  `CMD` pointed at a file that never existed, the uploads mountpoint needed
  app-user ownership, and the secret-rotation runbook claimed
  `AUTH_SESSION_SECRET` rotation invalidates sessions (it does not — global
  sign-out is `delete from sessions`). Deploy/backup/restore runbooks replayed end
  to end, including a scratch-stack restore with a playground query —
  [deployment](docs/operations/deployment.md#deploy-migrate).
- **Load + latency smoke** (T-402): `pnpm --filter api load:smoke` replays the
  NFR-1/2/8 envelope against any deployment — a 100-message webhook burst at 20
  concurrency (ack p95 ≤ 300 ms), 20 full-pipeline playground asks (e2e p95
  ≤ 15 s, retrieval p95 ≤ 500 ms) and a 50-job Redis-restart durability probe on
  a dedicated `load-smoke` queue with the ADR-0006 defaults (zero loss
  required). The CLI exits non-zero on any failed assertion, never touches real
  queues, and takes `--base-url`/`--insecure`/`--email`/`--password` for staging
  or prod runs — [deployment](docs/operations/deployment.md#load-smoke-nfr-128).
- **Retention cleanup** (T-403): a daily `retention-cleanup` job on the new
  `maintenance` queue deletes messages/conversations and answer/audit events older
  than `RETENTION_DAYS` (default 365, NFR-7) in 1,000-row batches — documents,
  chunks and KBs are never touched, and an immediate re-run is a no-op. The
  schedule (03:00 UTC) is upserted at every boot like the digest, and the env docs
  cover the new knob —
  [deployment](docs/operations/deployment.md#scheduled-jobs).
- **Ops alerting** (T-404): an `alert-check` job runs every 5 minutes on the
  `maintenance` queue and posts Slack-compatible messages to `ALERT_WEBHOOK_URL`
  when queues back up, jobs fail, the LLM error rate spikes, webhook 5xx pile up,
  or Redis memory nears its cap — with per-condition cooldown and BullMQ retries
  on delivery failure (unset webhook → warn logs) —
  [deployment](docs/operations/deployment.md#observability--alerting).
- **Dashboard UI foundation**: HeroUI v3 + Tailwind CSS v4 wired into `apps/web`
  (PostCSS pipeline, layered theme tokens, dark-mode ready); existing screens keep
  their interim styles until each is migrated —
  [development](docs/contributing/development.md#dashboard-ui-heroui).
- **Build plan**: ticket-level execution list for M0–M4 in
  [docs/contributing/build-plan.md](docs/contributing/build-plan.md).

### Fixed

- Settings writes now allow editor/admin per the capability matrix in
  [security](docs/operations/security.md) (T-205 shipped admin-only, contradicting the
  documented roles).
- Prettier now ignores the Next.js-generated `apps/web/next-env.d.ts` and the
  drizzle-kit-generated `apps/api/src/db/migrations/meta` JSON (both are rewritten by
  tooling).

<!--
Sections: Added, Changed, Deprecated, Removed, Fixed, Security.
When a release is cut: move [Unreleased] entries under a new version heading with
the date (e.g. `## [0.2.0] - 2026-11-01`) and start a fresh [Unreleased] block.
-->
