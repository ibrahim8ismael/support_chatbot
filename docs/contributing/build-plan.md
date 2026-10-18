# Build Plan — Tickets

Ticket-level execution list for the [roadmap](../product/roadmap.md): every roadmap
bullet is broken into small PR-sized tickets with explicit acceptance criteria and
requirement refs ([requirements](../product/requirements.md) FR-1…FR-9, NFR-1…NFR-9).

**How to use**

- One ticket ≈ one PR (conventional commit subject references the ticket, e.g.
  `feat(agent): reply pipeline (T-203)`).
- Keep the checkbox and status current **in the same PR as the work**.
- Every ticket's definition of done includes: tests for its decision logic, `pnpm lint
  / typecheck / test` green, and docs updated in the same PR (repo-structure module
  table, rest-api, ADRs).
- Legend: `[ ]` todo · `[~]` in progress · `[x]` done. Sizes: **S** ≈ ≤ ½ day,
  **M** ≈ 1–2 days, **L** = split before starting.

**Hard rules**

- No bot answers real customers until the eval gates pass (roadmap);
  `LLM_PROVIDER=mock` must always keep the full loop working without external calls.
- Never call Chatwoot outside the `chatwoot` module, models outside `llm` — see
  [repo-structure](../architecture/repo-structure.md).

**Execution order (decided 2026-10-18):** all non-Chatwoot tickets run first; the
Chatwoot integration is deliberately **last**. Order:
T-101 → T-005 → T-004 → T-102 → T-205 → T-206 → T-103 → T-104 → T-105 → T-106 →
T-107 → T-108 → T-301 → T-302 → T-303 → T-304 → T-305 → T-401 → T-402 → T-403 →
T-404 → **then Chatwoot:** T-002 → T-003 → T-201 → T-202 → T-203 → T-204 → T-207 →
T-208 → T-405.

## Decisions gating tickets

| Decision | Gates | Recommendation |
| --- | --- | --- |
| D3 embedding model & dimensions | T-101 (`vector(N)`) | **Closed 2026-10-18** — `text-embedding-3-small` (1536); mock provider mirrors the dimension |
| D6 ORM | T-101 (entities) | **Closed 2026-10-18** — Drizzle (as scaffolded) |
| D2 provider & residency | T-102 real providers, T-108 evals | **Closed 2026-10-18** — (a) external APIs: OpenAI (chat + embeddings) with OpenRouter as the alternate chat carrier; KB content leaves the network to these providers |
| D4 auth method | T-005 | **Closed 2026-10-18** — local email + password (argon2id, server-side sessions); OIDC remains a later option behind the same session layer |
| D7 handoff mechanism | T-204 | Label + assignee detection (both) |
| D9 file storage | T-103 | **Closed 2026-10-18** — local Docker volume (`UPLOAD_DIR`); files stored under generated names, DB keeps the relative path |

---

## M0 — Loop proven (Phase 0)

**Exit criteria:** message in a Chatwoot test inbox → bot echoes “I received: …” →
logged in DB; eval-free; `docker compose up` works on a clean machine.

- [x] **T-000 · Monorepo scaffold** (done) — pnpm + Turborepo, api/web/shared/config,
      docker compose, module skeletons, `/health`, webhook secret edge.
- [x] **T-001 · CI pipeline** (S) — GitHub Actions on PR: frozen-lockfile install,
      `lint`, `typecheck`, `test`, `build`; Turbo cache; Node 22 (matches prod image).
      Done: red on a broken PR, green on main.
- [ ] **T-002 · Chatwoot contract fixtures** (M) — capture anonymized real webhooks
      (`message_created` + friends) into `apps/api/test/fixtures/`; zod schemas for
      the payloads; schema tests. Needs a live test Chatwoot. Done: fixtures committed,
      drift caught by tests.
- [ ] **T-003 · Echo loop end-to-end** (L, split if needed) — webhook → conversations
      module (upsert, dedupe by `chatwoot_message_id`, per-conversation Redis lock) →
      `reply-job` queue → chatwoot `sendMessage` → message rows + request-id logging.
      Plus `pnpm mock:chatwoot` (mock server) to assert the loop without a live
      instance. Refs FR-5 P0, NFR-2/4. Done: e2e test proves webhook in → outbound
      call asserted (mocked Chatwoot).
- [x] **T-004 · Conversations module** (M) — conversation/message upsert & lookup,
      `bot_state` transitions, lock helpers. (Extracted out of T-003's scope.)
- [x] **T-005 · Auth skeleton** (M) — argon2id users, `sessions` rows, login/logout/me
      endpoints (rate-limited login), `AuthGuard`/`RolesGuard`/`CurrentUser`, seed-admin
      CLI, login page wired to the API. Refs FR-1 P0, D4.

## M1 — One KB answers (Phase 1: data → answers in playground)

**Exit criteria (roadmap M1):** uploaded document answered correctly in the playground
(no Chatwoot involved yet).

- [x] **T-101 · Entities + first migration** (M) — all tables from
      [data-model](../architecture/data-model.md) in their owning modules; `chunks`
      with `vector(N)`, HNSW + kb_id indexes; forward-only migration. Needs D3 + D6.
- [x] **T-102 · LLM module** (M) — Vercel AI SDK wiring; `embed()` / `generateReply()`
      / `classify()`; deterministic **mock provider** (`LLM_PROVIDER=mock`) used by dev
      and CI. Refs ADR-0005, NFR-9 (embedding cache via CacheService). Real providers
      per D2. **Done 2026-10-18**: mock (feature-hash embeddings + echo replies) and the
      embedding cache are live. **Real providers (same day, D2 closed)**: `openai`
      (chat + embeddings) and `openrouter` (chat; embeddings stay with OpenAI per D3)
      in the provider factory — provider-qualified model ids, missing keys / unknown
      providers fail fast at boot.
- [x] **T-103 · KB + documents API** (M) — CRUD, upload (PDF/DOCX/TXT/MD ≤ 20 MB) to
      `UPLOAD_DIR`, `content_hash`, status fields, reprocess + delete. Refs FR-2 P0, D9.
      **Done 2026-10-18**: list/detail with counts, create/patch/delete (409 while bound),
      upload with content sniffing + per-KB content dedupe, reprocess/delete document
      (cascades chunks, bumps `kb:{id}:version`), files enqueued on `ingest-document`.
- [x] **T-104 · Ingestion pipeline** (L) — `ingest-document` worker: parse (pdfjs,
      mammoth, text/md) → clean → chunk + metadata (`heading`, `page`) → batch embed →
      idempotent replace of chunks; 3 retries with backoff; `processing|ready|failed`
      + `error`, `chunk_count`. Refs FR-3 P0, pipeline doc. Done: e2e ingest of a PDF
      fixture with mock embeddings; re-run is a no-op by `content_hash`.
      **Done 2026-10-18**: BullMQ worker runs in-process (concurrency 2); pdfjs v6
      legacy / mammoth / TXT-MD parsers; repeated header/footer stripping and
      de-hyphenation; ~700-token chunks with ~100-token overlap, page-boundary flushes,
      and heading context for mid-section chunks; embeddings in batches of 100 with 3
      retries; transactional replace guarded by an advisory lock; duplicate deliveries
      are no-ops; the final failed attempt writes `failed` + a readable `error`.
      Live-verified: PDF + DOCX fixtures, duplicate job, reprocess, unparseable file.
- [x] **T-105 · Retrieval module** (M) — `retrieve(query, kbIds, opts)` → chunks +
      scores (cosine, HNSW), top-k/threshold from settings, `retrieval_events` write,
      embedding+retrieval caches (fail-open, TTL). Refs FR-4 P0, NFR-1 (≤ 500 ms),
      NFR-9.
      **Done 2026-10-18**: pgvector cosine search with threshold + top-k resolved from
      settings (per-call overrides), versioned `ret:v1:` cache (15 min, keys include
      the `kb:{id}:version` counters, so re-ingestion auto-invalidates), embedding
      cache reused from `llm`; per-request trace (timings, bestScore, cacheHit)
      returned by the debug endpoint `POST /knowledge-bases/:id/search` (any
      signed-in role).
      Event writing lands with the agent (T-106): `answer_events` needs
      conversation/message context and is owned by analytics — retrieval produces the
      trace only.
- [x] **T-106 · Agent core (playground path)** (M) — query build (recent context),
      versioned prompt templates, groundedness rules, fallback text, max reply chars,
      language matching; returns answer + trace (chunks, scores, tokens, latencies).
      Refs FR-4 P0, security doc (no prompt/retrieval leakage).
      **Done 2026-10-18**: `agent` module — `ask()` = query build (message + recent
      customer turns while referential) → retrieval → threshold gate (below → fallback
      message, escalated `low_score`, no generation) → versioned prompt (settings
      `system_prompt`, seeded from `answer.v1`: grounding rules, language matching,
      knowledge as `<kb>` data blocks) → `generateReply` → output guard (length cap,
      internals blocklist, filenames, non-KB URLs → escalate `guard`). Trace returned:
      grounded chunks + scores, token usage, latency split, model, prompt version.
      `POST /playground/ask` (any signed-in role; 404 for unknown KBs) exposes it;
      `answer_events` writes stay with the live pipeline (T-203), which owns
      conversation context. `COMPANY_NAME` env fills `{{company_name}}`.
- [x] **T-107 · KB + playground UI** (M) — KB list/create, upload with status, and
      playground (pick KBs → ask → exact chunks + scores + answer). Refs FR-8 P1.
      **Done 2026-10-18**: `apps/web` — `/knowledge-bases`: KB list + create,
      per-KB document table fed by the documents API, upload (client pre-checks
      mirroring the API's PDF/DOCX/TXT/MD ≤ 20 MB contract) with 2.5 s status
      polling while ingestion runs, reprocess + delete. `/playground`: multi-KB
      picker, question box, request building validated against the shared
      `playgroundAskSchema`, and the full trace per answer — grounded chunks with
      scores + source labels, escalation banner (low_score/guard),
      latency/tokens/model/prompt version; prior exchanges become the history sent
      with the next ask (last 10). Nav gains Playground; 401s bounce to `/login`.
      First web tests (vitest, 18) cover the pure request/validation logic.
- [x] **T-108 · Eval set + runner** (M) — 50–100 Q/A pairs for launch topics;
      `pnpm evals` runner printing groundedness + retrieval metrics; gates per
      [rag-pipeline](../architecture/rag-pipeline.md). **Done 2026-10-18**:
      `apps/api/evals/` — 3 topics × 20 cases (12 answer / 4 escalate / 4 injection)
      over a 10-document synthetic corpus, incl. referential follow-ups, must-escalate
      and injection attempts. `pnpm evals` boots the app context, ingests the corpus
      through the real upload → queue → worker path into a scratch KB, runs every case
      through `AgentService.ask()`, judges groundedness, writes per-topic + overall
      metrics and a results JSON, and exits non-zero on a gate failure (retrieval
      ≥ 0.90, groundedness ≥ 0.95, escalation ≥ 0.90, injection = 1.00, case errors =
      0). Dataset/constraints and gate math have CI specs; `mock-scores.ts` prints the
      offline score table used to tune corpus questions. Live mock run: all gates pass
      (60/60 cases); real groundedness numbers need an OpenAI/OpenRouter key.

## M2 — Live in one inbox (Phase 1: the bot answers customers, safely)

**Exit criteria (roadmap M2):** real customers get RAG answers in one inbox;
escalation works; humans can pause/resume.

- [ ] **T-201 · Webhook filters + serialization** (M) — full filter matrix
      ([chatwoot doc](../integrations/chatwoot.md)): outgoing/bot/private/assigned/
      paused inboxes/duplicates; deterministic `jobId = reply:<conversation_id>` +
      re-read-and-requeue on newer messages. Refs FR-5 P0, ADR-0006.
- [ ] **T-202 · Chatwoot outbound hardening** (M) — axios client with timeout/retry/
      logging interceptors; `sendMessage`, `addPrivateNote`, `addLabel`; failure →
      fallback message + handoff (never lose a reply). Refs FR-5/6, NFR-2.
- [ ] **T-203 · Reply pipeline (agent orchestrator)** (M) — reply-job worker gluing
      filters → retrieve → threshold decision → generate → post → `answer_events`
      with full latency/token/cost fields. Refs FR-4/6, NFR-4/6.
- [ ] **T-204 · Handoff / escalation** (M) — triggers table (FR-6) incl. P1 classifier
      & repeat detection; private note with intent/tried/why/chunk links; customer
      fallback message; `ai-paused` label + assignee detection (`conversation_updated`);
      resume flow. Refs FR-6 P0, D7.
- [x] **T-205 · Settings module** (M) — typed key/value table with defaults, 60 s cache
      + invalidation, admin endpoints; global kill switch + thresholds + prompts + model
      names. Refs FR-8 P0, caching doc. **Done 2026-10-18**: GET/PUT `/settings` +
      `/settings/health-llm`, zod-validated partial writes, Redis snapshot cache;
      `system_prompt` defaults to the versioned `agent/prompts/answer.v1.ts`.
- [x] **T-206 · Bindings module** (M) — inbox ↔ KB mapping CRUD, `enabled` per-inbox
      kill switch, `getBoundKbIdsForInbox()` cached, `display_name` cache from Chatwoot.
      Refs FR-5 P0. **Done 2026-10-18**: list/upsert API (editor/admin), per-inbox
      `bind:v1:*` cache (60 s + bust on write), `display_name` preserved for the
      Chatwoot sync; live inbox discovery lands with T-003.
- [ ] **T-207 · P1 niceties** (S) — attachments → escalate (D8), typing indicator if
      our Chatwoot version supports it, `conversation_status_changed` events.
- [ ] **T-208 · Rollout drill** (S, ops) — evals pass → enable one real inbox (website
      widget first); drill: pause label, resume, kill switches. Refs FR-8, roadmap M2
      exit criteria.

## M3 — Operable by the team (Phase 2)

**Exit criteria (roadmap M3):** support lead reads analytics weekly without
engineering; dashboard admin flows used by the team.

- [x] **T-301 · Event + audit writers** (S) — `recordAnswerEvent()`/`recordAuditLog()`
      used by agent, auth, KB, bindings, settings; retention fields. Refs FR-9 P0.
      **Done 2026-10-18**: `AnalyticsService` (analytics module) exposes both writers;
      each is best-effort (a failed insert is logged, never thrown — analytics must not
      break a reply or a successful request) and every row carries an indexed
      `created_at` as the retention key for T-403 (NFR-7). `AgentService.ask()` folds the
      attempt into `answer_events` (query, top-k/score, retrieved chunk ids, latencies,
      models, tokens) when the caller passes conversation context — the playground and
      evals don't, T-203 will; `ANSWER_OUTCOMES` gains `escalated_guard` for output-guard
      escalations. Audit rows are written for login success/failure (reason + IP/UA),
      logout (owner read before delete), KB create/update/delete, document
      upload/reprocess/delete, binding upserts (per-inbox kill switch) and settings
      updates (before/after diff per changed key).
- [x] **T-302 · Analytics API + screen** (M) — deflection/escalation rate, bot messages,
      latency avg/p95, token cost, filters (inbox, day/week/month), top-unanswered list;
      metric definitions contract in [rest-api](../api/rest-api.md) — do not silently
      change. Refs FR-7 P0.
      **Done 2026-10-18**: `AnalyticsController` exposes `overview` / `timeseries` /
      `unanswered` with the shared zod query schemas (defaults: last 7 days, `day`,
      limit 10; `from >= to` → 400). The SQL in `AnalyticsService` mirrors the contract:
      conversations = distinct conversations with an incoming message in `[from, to)`;
      botAnswered adds "no `human_agent` message within 24 h"; escalations/exports are
      per-bucket. `unanswered` clusters escalation rows by token Jaccard (≥ 0.6, newest
      500 scanned, representative = most frequent variant) and is admin-only — it returns
      customer text; aggregates stay open to all roles. The `/analytics` screen renders
      cards, a dependency-free bar chart (buckets UTC) and the unanswered table.
- [x] **T-303 · Conversation explorer** (M) — list + detail: messages, answer events,
      retrieved chunks with scores, escalation notes. Refs FR-7 P1.
      **Done 2026-10-18**: `ConversationsController` exposes `GET /conversations`
      (filters on `last_message_at`, paging via `limit`/`offset`, window total) and
      `GET /conversations/:id` (thread oldest → newest, private notes flagged).
      Answer events include the cited chunks in retrieval-rank order; per-chunk scores
      are not persisted, so each event's `topScore` is the score signal. Answer events
      are admin-only — the response flags `answerEventsRestricted` for other roles.
      The `/conversations` screen has a filter bar (range/state/inbox), a paged list and
      the thread + diagnostics panel.
- [x] **T-304 · Admin UIs** (M) — bindings, settings, users (admin), audit log screen.
      Refs FR-8/9.
      **Done 2026-10-18**: `UsersController` (`/api/users`, admin-only) implements
      create/list/patch/password-reset with session revocation on deactivation and
      password change (security.md § Session hygiene) and `users.*` audit rows;
      `AuditLogController` (`/api/audit-logs`, admin-only) serves the paginated,
      filterable trail with the acting user's email. Web: the `/bindings` and
      `/settings` placeholders became working screens (KB multi-select + per-inbox
      kill switch; typed settings form with `PUT /settings` and the admin LLM smoke
      check), plus new `/users` and `/audit` admin screens with 403 notes for other
      roles. Screen and API share the users/audit schemas.
- [ ] **T-305 · Weekly digest cron** (S) — repeatable BullMQ job posting “top unanswered”
      to the support channel; reviews cadence per roadmap.

## M4 — All inboxes & operations (Phase 3)

- [ ] **T-401 · Production deploy drill** (M) — build both Dockerfiles, `docker compose
      -f docker/docker-compose.prod.yml` on a clean host, Caddy TLS in front, migrate-
      on-deploy step, backup/restore + secret-rotation runbooks replayed and fixed.
      Refs deployment doc. Done: clean-machine runbook works end to end.
- [ ] **T-402 · Load + latency smoke** (M) — synthetic webhook burst (≤ 20 concurrent /
      ~5k conversations-month profile); assert webhook ack ≤ 300 ms, p95 end-to-end
      ≤ 15 s, no lost jobs across a Redis restart. Refs NFR-1/2/8.
- [ ] **T-403 · Retention job** (S) — configurable 12-month cleanup of messages/events
      (never documents/KBs). Refs NFR-7.
- [ ] **T-404 · Alerting** (S) — webhook error rate, queue depth/age, LLM error rate,
      Redis full; wire to the ops channel. Refs NFR-4.
- [ ] **T-405 · Rollout to remaining inboxes** (S, ops) — activate inboxes one by one
      via bindings; verify kill switches per inbox. Refs roadmap M4.

## Backlog (Phase 3+, no tickets yet)

Hybrid search + reranking (FR-4 P2), reply-level cache for exact repeats (NFR-9),
query-rewrite pass (FR-4 P1), agent-assist mode, SSO (FR-1 P1), URL sources (FR-2 P1),
CSAT correlation, KB versioning (FR-2 P2), CSV export (FR-7 P2).

## Requirement coverage

| Requirement | Tickets |
| --- | --- |
| FR-1 auth (P0) | T-005 |
| FR-2 KB management (P0) | T-103, T-107 |
| FR-3 ingestion (P0) | T-104 |
| FR-4 retrieval & answering (P0) | T-105, T-106, T-203, T-108 |
| FR-5 Chatwoot integration (P0) | T-003, T-201, T-202, T-206 |
| FR-6 escalation / handoff (P0) | T-203, T-204 |
| FR-7 analytics (P0) | T-301, T-302, T-305 |
| FR-8 settings & playground (P0/P1) | T-205, T-107, T-208 |
| FR-9 audit & ops (P0) | T-301, T-304, T-401–T-404 |
| NFR-1/2/4 performance & reliability | T-104, T-201, T-202, T-203, T-402 |
| NFR-9 caching | T-102, T-105, T-205 (+ reply-level cache in backlog) |
