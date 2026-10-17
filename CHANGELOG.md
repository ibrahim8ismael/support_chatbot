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
  ("I received: …" for the M0 loop) so dev and CI need no keys; unwired providers fail
  fast at boot until D2 (provider & residency) closes. Shared `EMBEDDING_DIMENSIONS`
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
