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

## Knowledge bases (`knowledge-base`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/knowledge-bases` | list + doc counts + status summary |
| POST | `/knowledge-bases` | `{ name, description }` |
| GET | `/knowledge-bases/:id` | detail |
| PATCH | `/knowledge-bases/:id` | rename, archive |
| DELETE | `/knowledge-bases/:id` | 409 if bound to an inbox |
| GET | `/knowledge-bases/:id/documents` | list w/ status, error, chunk_count |
| POST | `/knowledge-bases/:id/documents` | multipart `file` (PDF/DOCX/TXT/MD ≤ 20 MB) → `{ documentId, status: "processing" }` (P1: multiple files) |
| POST | `/knowledge-bases/:id/search` | debug retrieval: `{ query, topK? }` → chunks + scores. No model generation |
| POST | `/documents/:id/reprocess` | re-parse + re-embed |
| DELETE | `/documents/:id` | removes document + chunks |

## Playground (`agent`, P1 — pull into MVP)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/playground/ask` | `{ question, kbIds, history? }` → full pipeline result: `{ answer, escalated, chunks: [{ id, score, content, document }], latency, tokens }` |

## Bindings (`bindings`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/bindings` | all inbox bindings (joined with cached inbox names) |
| PUT | `/bindings/:chatwootInboxId` | `{ kbIds: [...], enabled: bool }` — upsert |
| GET | `/bindings/chatwoot-inboxes` | list of inboxes fetched live from Chatwoot (to configure ones we haven't seen) |

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
| GET | `/analytics/timeseries` | same filters, `?interval=day\|week\|month` → arrays for charts |
| GET | `/analytics/unanswered` | top unanswered questions (low-score / escalated), grouped by similarity, `{ query, count, lastSeen, sampleConversationId }` |
| GET | `/analytics/knowledge-bases/:id/usage` | chunks retrieved most/never, per document (P1) |

### Metric definitions (contract — do not silently change)

| Metric | Definition |
| --- | --- |
| `conversations` | distinct conversations with ≥ 1 incoming message in range |
| `botAnswered` | conversations where ≥ 1 `answer_events.outcome=answered` and no human message followed within 24 h |
| `deflectionRate` | `botAnswered / conversations` (per selected range/inbox) |
| `escalationRate` | conversations with an escalation outcome / conversations |
| `avgLatencyMs` | mean of `answer_events.total_ms` for `answered` rows |
| `estimatedCostUsd` | Σ `estimated_cost_usd` over the range |

## Settings (`settings`, admin for writes)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/settings` | all settings (typed) |
| PUT | `/settings` | partial update; validated per key |
| GET | `/settings/health-llm` | provider smoke check (embed + generate) for the admin UI |

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
