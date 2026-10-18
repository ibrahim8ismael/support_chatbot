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
| GET | `/users` | list |
| POST | `/users` | `{ email, name, role, password }` (invite flow P1) |
| PATCH | `/users/:id` | role, name, `is_active` |
| POST | `/users/:id/password` | admin reset |

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
| POST | `/knowledge-bases/:id/search` | any signed-in role; debug retrieval (T-105): strict `{ query, topK? }`, real embed + cosine search, no generation → `{ chunks: [{ chunkId, documentId, kbId, filename, score, metadata, content }], trace: { normalizedQuery, kbIds, topK, threshold, bestScore, returnedChunks, cacheHit, embeddingMs, searchMs, totalMs } }`; 404 for unknown KBs |
| POST | `/documents/:id/reprocess` | editor/admin; resets to `processing` and re-runs parse → chunk → embed |
| DELETE | `/documents/:id` | editor/admin; removes the document + its chunks + stored file, and bumps the KB version counter (retrieval caches miss) |

Uploads land in `UPLOAD_DIR` (D9: Docker volume) under generated names; `documents.storage_path` stores only that relative name.

## Playground (`agent`, P1 — pull into MVP)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/playground/ask` | any signed-in role (T-106): strict `{ question, kbIds (1–10), history? (≤ 20 turns) }` → the answer path with no Chatwoot: `{ answer, escalated, escalationReason, chunks: [{ id, score, content, document, metadata }], latency: { retrievalMs, generationMs, totalMs }, tokens: { input, output }, model, promptVersion }`; 404 for unknown KBs |

## Bindings (`bindings`, editor/admin)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/bindings` | all bindings ordered by inbox id; `displayName` is the name cached from Chatwoot |
| PUT | `/bindings/:chatwootInboxId` | full state `{ kbIds: [...], enabled: bool }` — upsert (strict body: known keys only, unique uuids); returns the saved binding and invalidates its `bind:v1:{inbox}` cache entry |
| GET | `/bindings/chatwoot-inboxes` | list of inboxes fetched live from Chatwoot (to configure ones we haven't seen) — lands with the Chatwoot client (T-003); the bindings module never calls Chatwoot itself |

## Conversations (`conversations`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/conversations` | filters: `inboxId`, `botState`, `from`, `to`; sorted by `last_message_at` desc |
| GET | `/conversations/:id` | messages + `answer_events` for the thread |
| POST | `/conversations/:id/pause` | `{ reason? }` → `bot_state=paused` |
| POST | `/conversations/:id/resume` | → `bot_state=active` (also removes `ai-paused` label in Chatwoot) |

## Analytics (`analytics`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/analytics/overview` | `?from&to&inboxId?` → `{ conversations, botAnswered, deflectionRate, escalationRate, avgLatencyMs, p95LatencyMs, tokensIn, tokensOut, estimatedCostUsd }` |
| GET | `/analytics/timeseries` | same filters, `?interval=day\|week\|month` (default `day`) → `{ interval, from, to, points: [{ bucket, …overview metrics }] }`; buckets are UTC and gap-free |
| GET | `/analytics/unanswered` | **admin** (exposes customer question text, security § 4); `?from&to&inboxId?&limit=1..50` (default 10) → `[{ query, count, lastSeen, sampleConversationId }]`, escalation rows in range grouped by query similarity (token Jaccard ≥ 0.6, most recent 500 scanned) |
| GET | `/analytics/knowledge-bases/:id/usage` | chunks retrieved most/never, per document (P1) |

Filters: `from`/`to` are ISO 8601, the range is half-open `[from, to)`; `to` defaults to now, `from` to 7 days before `to`; `from >= to` → 400. `overview`/`timeseries` follow the security matrix (all signed-in roles).

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
| GET | `/audit-logs` | `?userId&action&from&to`, paginated |

## Webhooks (public)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/webhooks/chatwoot/:secret` | [contract & payload](../integrations/chatwoot.md). Verifies path secret; 200 fast; queues work. Returns 404 for wrong secret (never 401 — do not confirm the endpoint exists) |

## Health (public)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ status: "ok", db: "ok", redis: "ok", queue: "ok", version }` — shallow checks only; used by Docker/compose healthcheck and uptime checks |

## Notes on versioning

- Internal API: no URL versioning for MVP; breaking changes ship together with the web app (same repo, same release).
- The **Chatwoot contract** (webhook + outbound calls) is versioned by Chatwoot, not by us — see the fixture tests in [chatwoot.md](../integrations/chatwoot.md#testing-the-integration).
