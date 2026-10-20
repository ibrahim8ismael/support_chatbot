# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/) — curated entries are added
here in the same PR as user-visible changes. Ticket IDs refer to the
[build plan](docs/contributing/build-plan.md).

## [Unreleased]

## [0.2.0] - 2026-10-20

### Added

- **Google Gemini chat provider** (T-102, D2): `LLM_PROVIDER=gemini` routes chat
  through `@ai-sdk/google` using `GEMINI_API_KEY` (or the SDK's
  `GOOGLE_GENERATIVE_AI_API_KEY` alias) while embeddings stay with OpenAI
  (`text-embedding-3-small`, D3), so Gemini also requires `OPENAI_API_KEY`.
  `CHAT_MODEL` is now optional and defaults per provider:
  `gpt-4.1-mini` (OpenAI), `openai/gpt-4.1-mini` (OpenRouter), and
  `gemini-3.8-flash` (Gemini). Provider-qualified ids (`gemini:…`) keep the
  embedding cache and `answer_events` model columns unambiguous, and cost
  estimates now strip provider prefixes (fixing existing `openai:…` prices too).

## [0.1.1] - 2026-10-20

### Fixed

- **Sandbox runs enqueue reliably**: BullMQ rejects custom job ids containing
  `:`, so creating or retrying a run failed with `503 sandbox queue unavailable`.
  Job ids now use hyphens, with a regression test covering both paths.

## [0.1.0] - 2026-10-20

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
  (PostCSS pipeline, layered theme tokens, dark-mode ready), now used by every
  dashboard screen —
  [development](docs/contributing/development.md#dashboard-ui-heroui).
- **Login screen**: rebuilt with HeroUI — centered auth block, accessible
  TextField/Form/Alert primitives, pending spinner and the same session-cookie
  flow.
- **Dashboard shell**: HeroUI sidebar/header with grouped navigation, a responsive
  drawer, a light/dark/system theme toggle (`next-themes`) and an account menu
  backed by `/auth/me` with sign-out.
- **Knowledge bases screen**: HeroUI two-pane layout — KB cards with document
  counts, create-in-modal form, documents table with status chips, upload,
  reprocess and delete actions; polling unchanged.
- **Playground screen**: HeroUI KB checkboxes and question composer, answer cards
  with escalation status, grounded chunks, scores and trace metadata.
- **Conversations screen**: HeroUI filter bar (range presets plus Select-based
  state/inbox filters), conversation cards, and a detail card with message
  bubbles and collapsible bot-attempt traces.
- **Inbox bindings screen**: one HeroUI card per inbox with the kill-switch
  `Switch`, KB `Checkbox` mapping, unsaved-changes chip and per-row save; the
  add-inbox form uses an `Input` + button.
- **Analytics screen**: HeroUI stat-card grid, token-styled bar chart with
  range/interval/inbox Select filters, and an unanswered-questions `Table`.
- **Settings screen**: HeroUI card with Switch/TextField/TextArea controls for
  runtime tunables, Save + LLM health-check actions, and success/danger Alerts.
- **Users screen**: HeroUI account cards with inline name/role/active editing,
  a toggleable password-reset form and an add-user form card.
- **Audit log screen**: HeroUI range/action/user filters and a result `Table`
  with expandable JSON payloads, plus the admin-only warning.
- **Dashboard UI cleanup**: removed the transitional legacy CSS tokens and the
  global anchor color override now that every dashboard screen uses HeroUI.
- **Build plan**: ticket-level execution list for M0–M4 in
  [docs/contributing/build-plan.md](docs/contributing/build-plan.md).

### Changed

- **Dashboard API origin**: `NEXT_PUBLIC_API_URL` is now optional — unset means
  the dashboard calls the API on its own origin (what the bundled Caddy setup
  serves); a malformed value fails the build instead of silently sending
  requests to the wrong host. Local dev keeps setting it to
  `http://localhost:3001`.
- **Config cleanup**: `AUTH_SESSION_SECRET` is gone — it was validated at boot
  but never read (sessions are server-side rows), so the schema, examples and
  docs no longer carry it; `APP_URL` and `REDIS_URL` must now be set explicitly
  in production (no silent localhost defaults). Upgrade notes: delete
  `AUTH_SESSION_SECRET` from the production `.env` (harmless if left, but
  unused), and confirm both URLs are present — the API refuses to boot in
  production without them. If migration 0002 fails on a pre-existing duplicate
  live document row (possible only from the old upload race), remove the
  duplicate first.
- **No mock in production, period**: the `ALLOW_MOCK_LLM` escape hatch is
  removed — production refuses to boot in `LLM_PROVIDER=mock` mode. The mock
  provider stays for local dev, tests and CI. Upgrade note: delete the variable
  from the production `.env`; a host still set to `mock` now fails fast at boot
  instead of serving canned replies.
- **README** rewritten as the open-source setup guide: what works today vs the
  Chatwoot pipeline stub, Docker self-host steps (configure → start → seed the
  first admin → teach it your knowledge bases), local development quick start,
  config highlights and a docs index.

### Fixed

- **Decompression-bomb hardening**: document parsing now runs in a child
  process the API supervises (512 MiB memory budget, 120 s wall clock, 32 MiB
  output cap). A crafted DOCX/PDF can inflate to gigabytes _before_ any
  text-level cap applies — the parse child is killed and the document fails
  readably instead of taking down the API (the last two HIGH findings of the
  pre-production audit). The API process no longer loads the PDF/DOCX parser
  libraries itself.
- **Audit P2/P3 — dashboard**: the sidebar hides pages the current role cannot
  open (bindings/audit/users), settings shows the environment-managed model ids
  read-only and disables its controls for viewers, and the knowledge-base,
  user and binding controls go read-only with a banner instead of letting the
  API answer 403; the users screen blocks self-demote, self-deactivate and
  removing the last active admin up front, warns that a self password reset
  signs you out, and resets the create-user role picker after a successful
  create; the login form parses the API's 429/5xx messages and verifies the
  session cookie via `/auth/me` before redirecting, and the shell surfaces a
  failed session probe with a Retry instead of an endless "Loading…"; uploads
  can be cancelled, in-flight saves lock the row's fields (users/bindings),
  audit filters are debounced (300 ms), "Save changes" is disabled until
  something changed, the global bot kill switch persists the moment it flips
  (like the per-inbox switch) instead of waiting for Save, and the inbox
  filter explains itself when bindings are
  editor/admin. Accessibility: async errors are announced (`role="alert"`),
  range presets carry `aria-pressed`, the selected conversation carries
  `aria-current`, the analytics chart exposes its numbers as a screen-reader
  table, and long question/answer text wraps on small screens.
- **Audit P2/P3 — auth & session**: login denials are audited at most once per
  (reason, subject) per minute, so an anonymous flood can no longer grow
  `audit_logs` one row per rejected request; the 15-minute lockout is scoped to
  (account, source address) so a stranger cannot lock a known account out with
  eight spaced attempts; the session cookie is re-issued whenever the session
  row slides (the cookie used to die 7 days after login while the DB row kept
  sliding); non-GET requests carrying a foreign `Origin`/`Sec-Fetch-Site`
  header are rejected with 403 on top of the existing `SameSite=Lax` cookie.
- **Audit P2/P3 — data, cost and resource guards**: conversation detail reads
  are capped at the newest 500 messages / 200 answer events, the user list at
  500 rows and KB document lists at 200; uploads gain a partial unique index on
  `(kb_id, content_hash)` excluding `failed` rows (migration 0002) that closes
  the concurrent-upload race — the loser now gets the same 409 — and
  reprocessing a failed copy whose content went live again 409s instead of
  corrupting state; playground ask and KB search enforce a per-user 30/min cap
  plus a global daily budget (`LLM_DAILY_REQUEST_LIMIT`, default 3000,
  `0` disables); the embedding cache is bounded in size and count (base64
  float32 ≈ 8 KB/vector, 24 h TTL, ≤ 200 fresh vectors per hour, `emb:v2`
  namespace); `WORKER_CONCURRENCY` now actually configures the ingest worker
  (default 2); `estimated_cost_usd` is populated for known chat models.
- **Synthetic scripts can't touch live inboxes**: the load-smoke webhook burst
  refuses non-local targets whose inbox has an enabled binding (and fails
  closed when the target cannot be verified) unless `--allow-live-burst` is
  passed; the webhook simulator refuses to run under `NODE_ENV=production`.
  Mock traffic can no longer leak into a production inbox once the reply
  pipeline lands.
- **Redis auth in production**: the prod compose now starts Redis with
  `requirepass` — `REDIS_PASSWORD` is mandatory (fail-fast), the healthcheck
  authenticates via `REDISCLI_AUTH`, the example env and deployment tables are
  in sync, and the queue/cache runbook commands authenticate. The security
  doc's claim of a password-protected prod Redis is now true instead of
  aspirational. **Existing hosts:** add `REDIS_PASSWORD` and the
  `redis://:<password>@…` URL form to `.env` before the next `up` — compose
  refuses to start without them.
- **Prompt-injection boundary**: chunk content is now fenced in code — `<kb>`
  delimiter lookalikes are escaped (`</kb>` → `&lt;/kb>`), so a poisoned
  document cannot close its data block and speak at top level; the answer
  prompt (`answer.v2`) states explicitly that `<kb>` content is data, never
  instructions, and that injection attempts must be refused with an escalation.
  Renderer tests cover both the escape and the `<kbd>` false-positive case;
  real-model injection evals still need a provider key.
- **Chatwoot alignment**: the webhook endpoint now answers
  `501 {"status":"not_implemented"}` after the path-secret check instead of
  pretending to accept events (it never processed anything); the integration
  doc carries a status banner separating current behavior from the target
  contract, setup steps match current Chatwoot (Settings → Bots, inbox Bot
  Configuration), retry semantics are corrected (Agent Bot deliveries retry
  only 429/500), and security guidance covers `X-Chatwoot-Signature`. The
  webhook simulator, load-smoke expectations and deployment docs follow.
- **Resource limits**: provider calls (chat, classify, embeddings) now carry
  abort timeouts (60 s / 120 s) so a stalled model API cannot hang requests or
  workers; the embedding cache TTL is bounded at 7 days; PDFs over 500 pages,
  documents extracting over 2M characters or producing over 2000 chunks fail
  cleanly; the digest webhook has a 10 s timeout and question text is no longer
  written to logs when it isn't posted; BullMQ job history is bounded (failed
  7 days / 1000, completed 1 day / 1000) so `noeviction` Redis cannot fill up.
- **API data guards**: analytics windows are capped at 366 days (400 beyond);
  bindings reject unknown knowledge-base ids; user updates refuse self-demotion/
  self-deactivation and removing the last active admin, and password resets now
  update the hash and drop sessions in one transaction; retrieval only cites
  `ready` documents in active KBs and caches per `topK`/threshold; a composite
  `messages(created_at, direction)` index backs range scans, and `answer_events`
  message FKs cascade/set null so retention batches cannot fail on boundary rows.
- **Web data integrity**: sign-out now only redirects after the API confirms it
  (errors keep you signed in with a visible explanation); inbox bindings refuse
  duplicate adds and list-load failures; KB documents clear when the selection
  changes and poll with one in-flight request instead of a stacking interval;
  conversation/analytics/audit views clear stale results when filters change and
  surface every request error; conversation and playground views no longer pair
  a new selection/draft with the previous transcript or answer.
- **API client**: 15 s timeout on JSON calls (120 s uploads) with a friendly
  timeout error, zod `details` rendered per field, and JSON content type only on
  requests with a body. Added a dashboard `error.tsx` boundary and `not-found.tsx`.
- **Production guards**: the API refuses to boot in production with the mock LLM
  provider (unless `ALLOW_MOCK_LLM=true`), known placeholder secrets, the default
  `Acme Support` company name or default database credentials; the active model set
  is logged at boot. Eval runs refuse to target `NODE_ENV=production` without
  `--allow-production` and write artifacts next to the script.
- **Login throttling** now uses atomic Redis counters (Lua `INCR`+`EXPIRE`)
  instead of read-modify-write, adds a per-account burst cap (5 checks / 10 s)
  that bounds parallel password guessing and argon2id CPU use, caps login email
  length (254) and persisted user-agent length (512), and trusts exactly one
  proxy hop so per-IP limiting works behind Caddy.
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
