# REST API

Design of the dashboard + webhook API exposed by `apps/api`. Once the code exists, the generated OpenAPI (Swagger) is the mechanical reference — this doc is the design contract.

## Conventions

- Base path: `/api` (webhook lives at `/api/webhooks/...`).
- Auth: session cookie for everything except `POST /auth/login`, the webhook, and `/health`.
- Errors: `{ "statusCode": 404, "error": "Not Found", "message": "Document not found" }` (NestJS standard). Validation errors: 400 with field details.
- Pagination: `?page=1&pageSize=20` → `{ items, total, page, pageSize }`. Max `pageSize=100`.
- Filtering by date: `?from=2026-10-01&to=2026-10-17` (ISO dates).
- All ids in responses are our UUIDs unless the field is named `chatwoot_*`.

## Auth (`auth`)

| Method | Path | Body / notes |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password }` → `{ user }` + sets the session cookie (httpOnly, sameSite=lax, sliding 7d). 401 on bad creds; 429 from per-IP / per-account throttling |
| POST | `/auth/logout` | kills the session row and clears the cookie (idempotent) |
| GET | `/auth/me` | `{ user }` for the session cookie holder |

## Users (`users`, admin only except /me)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users` | array of `{ id, email, name, role, isActive, createdAt, updatedAt }`, oldest first; never the password hash |
| POST | `/users` | `{ email, name, role, password }` — password policy as login (≥ 12 chars) → 201 created user; duplicate email → 409 |
| PATCH | `/users/:id` | partial `{ name?, role?, isActive? }`, at least one field; `isActive: false` revokes every session of that user |
| POST | `/users/:id/password` | `{ password }` → `{ status: "ok" }`; re-hashes and revokes every session of that user |

Every change writes an audit row (`users.create` / `users.update` / `users.password_reset`); deactivation and password resets drop the target's sessions (security.md § Session hygiene).

## Knowledge bases (`knowledge-base`, editor/admin for writes)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/knowledge-bases` | any signed-in role; summaries: KB + `documentCount` + `statusCounts` (`processing/ready/failed`), ordered by name |
| POST | `/knowledge-bases` | editor/admin; strict `{ name, description? }` → 201 with the summary |
| GET | `/knowledge-bases/:id` | any signed-in role; summary (same shape as list items) |
| PATCH | `/knowledge-bases/:id` | editor/admin; `{ name?, description?, status? }` — at least one field; `status: "archived"` is the archive path |
| DELETE | `/knowledge-bases/:id` | editor/admin; 409 if the KB is bound to an inbox. Hard delete: cascades documents + chunks and removes stored files |
| GET | `/knowledge-bases/:id/documents` | any signed-in role; newest first, with `status`, `error`, `chunkCount` |
| POST | `/knowledge-bases/:id/documents` | editor/admin; multipart `file` (PDF/DOCX/TXT/MD ≤ 20 MB) → 201 `{ documentId, status: "processing" }`. Content is sniffed, not trusted by extension (bad type → 400 with details, too large → 413, identical content already in the KB → 409). P1: multiple files |
| POST | `/knowledge-bases/:id/search` | any signed-in role; debug retrieval (T-105): strict `{ query, topK? }`, real embed + cosine search, no generation → `{ chunks: [{ chunkId, documentId, kbId, filename, score, metadata, content }], trace: { normalizedQuery, kbIds, topK, threshold, bestScore, returnedChunks, cacheHit, embeddingMs, searchMs, totalMs } }`; 404 for unknown KBs; 429 over the per-user (30/min) or global daily AI budget |
| POST | `/documents/:id/reprocess` | editor/admin; resets to `processing` and re-runs parse → chunk → embed |
| DELETE | `/documents/:id` | editor/admin; removes the document + its chunks + stored file, and bumps the KB version counter (retrieval caches miss) |

Uploads land in `UPLOAD_DIR` (D9: Docker volume) under generated names; `documents.storage_path` stores only that relative name.

## Playground (`agent`, P1 — pull into MVP)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/playground/ask` | any signed-in role (T-106): strict `{ question, kbIds (1–10), history? (≤ 20 turns) }` → the answer path with no Chatwoot: `{ answer, escalated, escalationReason, chunks: [{ id, score, content, document, metadata }], latency: { retrievalMs, generationMs, totalMs }, tokens: { input, output }, model, promptVersion }`; 404 for unknown KBs; 429 over the per-user (30/min) or global daily AI budget |

## Sandbox (`sandbox`, editor/admin)

Owner-facing accuracy testing (docs/product/sandbox.md). Saved cases and batch
runs execute through the same `AgentService.ask()` path as the Playground but
never write `answer_events`, touch Chatwoot, or change live settings. A run
snapshots its cases, KBs, settings, and prompt version; per-case failures become
result rows. Creating a run is capped at 100 cases and 10 runs per user per UTC
day. `DELETE` on a case is admin-only; everything else is editor/admin.

| Method | Path | Body / notes |
| --- | --- | --- |
| GET | `/sandbox/cases` | newest first |
| POST | `/sandbox/cases` | strict `{ name?, question, kbIds, history?, expectedBehavior?, expectedFilenames?, requiredPhrases?, forbiddenPhrases?, referenceAnswer?, tags?, notes?, isEnabled? }` → 201 case |
| PATCH | `/sandbox/cases/:id` | partial case, at least one field |
| DELETE | `/sandbox/cases/:id` | admin; results keep their snapshot (`case_id` becomes null) |
| GET | `/sandbox/runs` | latest 50, newest first |
| POST | `/sandbox/runs` | strict `{ name?, kbIds, caseIds? }`; omitted `caseIds` = all enabled cases → 201 run + queued job |
| GET | `/sandbox/runs/:id` | run status, progress, settings snapshot, metrics |
| GET | `/sandbox/runs/:id/results` | ordered by `position`, max 100 |
| POST | `/sandbox/runs/:id/cancel` | stops between cases; already-finished → 400 |
| POST | `/sandbox/runs/:id/retry-failed` | resets `error` results to `pending` (and resumes cancelled/failed pending cases), then requeues; nothing to do → 400 |
| PATCH | `/sandbox/results/:id/review` | `{ status: "unreviewed" \| "pass" \| "fail", note? }`; updates the run's verified metric |

The worker (`sandbox-run` queue) has concurrency 1; retries resume only pending
results, so a crash never re-runs a completed case.

## Bindings (`bindings`, editor/admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/bindings` | all bindings ordered by inbox id; `displayName` is the name cached from Chatwoot |
| PUT | `/bindings/:chatwootInboxId` | full state `{ kbIds: [...], enabled: bool }` — upsert (strict body: known keys only, unique uuids); returns the saved binding and invalidates its `bind:v1:{inbox}` cache entry |
| GET | `/bindings/chatwoot-inboxes` | list inboxes fetched live from Chatwoot; requires optional `CHATWOOT_ACCOUNT_API_TOKEN` (a user API token), otherwise returns 503; transport stays in the Chatwoot module |

## Conversations (`conversations`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/conversations` | `?inboxId&botState&from&to&limit&offset` → `{ items, total }`; `from`/`to` filter `last_message_at` (half-open; `from >= to` → 400); sorted by `last_message_at` desc (nulls last); `limit` 1–100 (default 50), `offset` ≥ 0; all roles |
| GET | `/conversations/:id` | `{ conversation, messages, answerEvents, answerEventsRestricted }` — messages oldest → newest with private notes flagged; answer events (query text + cited chunks in retrieval-rank order) are admin-only, other roles get `[]` and `answerEventsRestricted: true`; unknown id → 404 |
| POST | `/conversations/:id/pause` | → `bot_state=paused`; also adds the `ai-paused` label in Chatwoot |
| POST | `/conversations/:id/resume` | → `bot_state=active`; removes `ai-paused` and `ai-escalated` labels in Chatwoot |

## Analytics (`analytics`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/analytics/overview` | `?from&to&inboxId?` → `{ conversations, botAnswered, deflectionRate, escalationRate, avgLatencyMs, p95LatencyMs, tokensIn, tokensOut, estimatedCostUsd }` |
| GET | `/analytics/timeseries` | same filters, `?interval=day\|week\|month` (default `day`) → `{ interval, from, to, points: [{ bucket, …overview metrics }] }`; buckets are UTC and gap-free |
| GET | `/analytics/unanswered` | **admin** (exposes customer question text, security § 4); `?from&to&inboxId?&limit=1..50` (default 10) → `[{ query, count, lastSeen, sampleConversationId }]`, escalation rows in range grouped by query similarity (token Jaccard ≥ 0.6, most recent 500 scanned) |
| GET | `/analytics/knowledge-bases/:id/usage` | chunks retrieved most/never, per document (P1) |

Filters: `from`/`to` are ISO 8601, the range is half-open `[from, to)`; `to` defaults to now, `from` to 7 days before `to`; `from >= to` → 400, and windows larger than 366 days → 400 (bounded scans). `overview`/`timeseries` follow the security matrix (all signed-in roles).

### Metric definitions (contract — do not silently change)

| Metric | Definition |
| --- | --- |
| `conversations` | distinct conversations with ≥ 1 incoming message in range |
| `botAnswered` | conversations where ≥ 1 `answer_events.outcome=answered` and no human message followed within 24 h |
| `deflectionRate` | `botAnswered / conversations` (per selected range/inbox); 0 when the range is empty |
| `escalationRate` | conversations with an escalation outcome / conversations |
| `avgLatencyMs` | mean of `answer_events.total_ms` for `answered` rows |
| `p95LatencyMs` | 95th percentile of `answer_events.total_ms` for `answered` rows |
| `tokensIn` / `tokensOut` | Σ `tokens_in` / `tokens_out` over the range |
| `estimatedCostUsd` | Σ `estimated_cost_usd` over the range |

## Settings (`settings`, editor/admin for writes)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/settings` | typed snapshot, defaults merged in; any signed-in role; cached 60 s |
| PUT | `/settings` | editor/admin; partial update, validated per key (unknown keys and out-of-range values → 400 with field details); returns the updated snapshot and busts the cache |
| GET | `/settings/health-llm` | admin; provider smoke check (embed + generate) for the admin UI — `{ status: "ok", embedding: { model, dimensions, latencyMs }, chat: { model, latencyMs }, totalLatencyMs }`; provider failure → 503 `{ status: "error", message }` |

Keys and defaults: [data-model](../architecture/data-model.md#settings-owner-settings). Secrets (API keys, Chatwoot tokens) are never settings — environment only.

## Audit log (`analytics`, admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/audit-logs` | `?userId&action&from&to&limit&offset` → `{ items, total }`; `action` matches exactly, `from`/`to` are half-open on `created_at` (`from >= to` → 400); newest first with the acting user's email joined in |

## Webhooks (public)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/webhooks/chatwoot/:secret` | [contract & payload](../integrations/chatwoot.md). Verifies the path secret and, when configured, Chatwoot HMAC/timestamp; supported events return 200 after queueing, unsupported or malformed `conversation_updated` events return 200 ignored, malformed `message_created` payloads return 400, invalid signatures return 401, wrong path secret 404, and queue failures 500 |

## Health (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ status: "ok", db: "ok", redis: "ok", queue: "ok", version }` — shallow checks only; used by Docker/compose healthcheck and uptime checks |

## Notes on versioning

- Internal API: no URL versioning for MVP; breaking changes ship together with the web app (same repo, same release).
- The **Chatwoot contract** (webhook + outbound calls) is versioned by Chatwoot, not by us — stage against the exact deployed version; see [chatwoot.md](../integrations/chatwoot.md#validation-and-limitations).
