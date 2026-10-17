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

## Decisions gating tickets

| Decision | Gates | Recommendation |
| --- | --- | --- |
| D3 embedding model & dimensions | T-101 (`vector(N)`) | `text-embedding-3-small` (1536); mock provider mirrors the dimension |
| D6 ORM | T-101 (entities) | Drizzle (as scaffolded) |
| D2 provider & residency | T-102 real providers, T-108 evals | Build mock-first; decide before evals |
| D4 auth method | T-005 | Local email + password (proposed) |
| D7 handoff mechanism | T-204 | Label + assignee detection (both) |
| D9 file storage | T-103 | Docker volume behind the KB module |

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
- [ ] **T-004 · Conversations module** (M) — conversation/message upsert & lookup,
      `bot_state` transitions, lock helpers. (Extracted out of T-003's scope.)
- [ ] **T-005 · Auth skeleton** (M) — argon2id users, `sessions` rows, login/logout/me
      endpoints (rate-limited login), `AuthGuard`/`RolesGuard`/`CurrentUser`, seed-admin
      CLI, login page wired to the API. Refs FR-1 P0, D4.

## M1 — One KB answers (Phase 1: data → answers in playground)

**Exit criteria (roadmap M1):** uploaded document answered correctly in the playground
(no Chatwoot involved yet).

- [ ] **T-101 · Entities + first migration** (M) — all tables from
      [data-model](../architecture/data-model.md) in their owning modules; `chunks`
      with `vector(N)`, HNSW + kb_id indexes; forward-only migration. Needs D3 + D6.
- [ ] **T-102 · LLM module** (M) — Vercel AI SDK wiring; `embed()` / `generateReply()`
      / `classify()`; deterministic **mock provider** (`LLM_PROVIDER=mock`) used by dev
      and CI. Refs ADR-0005, NFR-9 (embedding cache via CacheService). Real providers
      per D2.
- [ ] **T-103 · KB + documents API** (M) — CRUD, upload (PDF/DOCX/TXT/MD ≤ 20 MB) to
      `UPLOAD_DIR`, `content_hash`, status fields, reprocess + delete. Refs FR-2 P0, D9.
- [ ] **T-104 · Ingestion pipeline** (L) — `ingest-document` worker: parse (pdfjs,
      mammoth, text/md) → clean → chunk + metadata (`heading`, `page`) → batch embed →
      idempotent replace of chunks; 3 retries with backoff; `processing|ready|failed`
      + `error`, `chunk_count`. Refs FR-3 P0, pipeline doc. Done: e2e ingest of a PDF
      fixture with mock embeddings; re-run is a no-op by `content_hash`.
- [ ] **T-105 · Retrieval module** (M) — `retrieve(query, kbIds, opts)` → chunks +
      scores (cosine, HNSW), top-k/threshold from settings, `retrieval_events` write,
      embedding+retrieval caches (fail-open, TTL). Refs FR-4 P0, NFR-1 (≤ 500 ms),
      NFR-9.
- [ ] **T-106 · Agent core (playground path)** (M) — query build (recent context),
      versioned prompt templates, groundedness rules, fallback text, max reply chars,
      language matching; returns answer + trace (chunks, scores, tokens, latencies).
      Refs FR-4 P0, security doc (no prompt/retrieval leakage).
- [ ] **T-107 · KB + playground UI** (M) — KB list/create, upload with status, and
      playground (pick KBs → ask → exact chunks + scores + answer). Refs FR-8 P1.
- [ ] **T-108 · Eval set + runner** (M) — 50–100 Q/A pairs for launch topics;
      `pnpm evals` runner printing groundedness + retrieval metrics; gates per
      [rag-pipeline](../architecture/rag-pipeline.md). Needs D2/D3 final. Done: a
      regression (threshold too low, prompt change) fails the gate.

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
- [ ] **T-205 · Settings module** (M) — typed key/value table with defaults, 60 s cache
      + invalidation, admin endpoints; global kill switch + thresholds + prompts + model
      names. Refs FR-8 P0, caching doc.
- [ ] **T-206 · Bindings module** (M) — inbox ↔ KB mapping CRUD, `enabled` per-inbox
      kill switch, `getBoundKbIdsForInbox()` cached, `display_name` cache from Chatwoot.
      Refs FR-5 P0.
- [ ] **T-207 · P1 niceties** (S) — attachments → escalate (D8), typing indicator if
      our Chatwoot version supports it, `conversation_status_changed` events.
- [ ] **T-208 · Rollout drill** (S, ops) — evals pass → enable one real inbox (website
      widget first); drill: pause label, resume, kill switches. Refs FR-8, roadmap M2
      exit criteria.

## M3 — Operable by the team (Phase 2)

**Exit criteria (roadmap M3):** support lead reads analytics weekly without
engineering; dashboard admin flows used by the team.

- [ ] **T-301 · Event + audit writers** (S) — `recordAnswerEvent()`/`recordAuditLog()`
      used by agent, auth, KB, bindings, settings; retention fields. Refs FR-9 P0.
- [ ] **T-302 · Analytics API + screen** (M) — deflection/escalation rate, bot messages,
      latency avg/p95, token cost, filters (inbox, day/week/month), top-unanswered list;
      metric definitions contract in [rest-api](../api/rest-api.md) — do not silently
      change. Refs FR-7 P0.
- [ ] **T-303 · Conversation explorer** (M) — list + detail: messages, answer events,
      retrieved chunks with scores, escalation notes. Refs FR-7 P1.
- [ ] **T-304 · Admin UIs** (M) — bindings, settings, users (admin), audit log screen.
      Refs FR-8/9.
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
| NFR-9 caching | T-102, T-105, T-205, T-306 backlog |
