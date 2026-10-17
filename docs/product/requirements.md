# Requirements

Scope of the MVP and what comes right after. Priorities: **P0** = MVP, blocks launch. **P1** = shortly after launch. **P2** = later/if needed.

## Functional requirements

### FR-1 — Dashboard authentication

- P0: Email + password login for team members. Passwords hashed with argon2; session cookie (`httpOnly`, `secure`, `sameSite=lax`); logout; “me” endpoint.
- P0: Roles: `admin` (everything incl. users/settings), `editor` (KBs, bindings, documents), `viewer` (read + analytics).
- P1: Company SSO (Google Workspace / Okta).
- P0: All dashboard endpoints require an authenticated session; the only public endpoints are login and the Chatwoot webhook.

### FR-2 — Knowledge base management

- P0: Create/edit/delete knowledge bases (name, description).
- P0: Upload documents to a KB: **PDF, DOCX, TXT, MD** (max 20 MB per file by default).
- P0: Document list per KB with ingestion status: `processing | ready | failed (+error message)`.
- P0: Re-process a document (re-chunk + re-embed) and delete a document (removes chunks).
- P1: Add content by URL (single page scrape) and by pasted text.
- P1: Bulk upload (multiple files, drag & drop) with per-file status.
- P2: Scheduled re-sync of URL sources; KB versioning/archival.

### FR-3 — Ingestion (RAG)

- P0: Automatic pipeline: parse → clean → chunk → embed (batch) → store in pgvector. Details: [RAG pipeline](../architecture/rag-pipeline.md).
- P0: Idempotent: re-running ingestion for a document fully replaces its chunks; failures are retried (max 3) and surfaced with a reason.
- P0: Every chunk keeps traceability: document → KB → original filename, page/section when available.

### FR-4 — Retrieval & answering

- P0: On each incoming customer message: build a search query (using recent conversation context), embed it, and fetch top-k chunks from the KBs bound to that inbox.
- P0: Answer **only** from retrieved content; if the best similarity score is below the configured threshold, do not answer from thin air — use the fallback path (FR-6).
- P0: Reply in the customer's language and in a friendly, on-brand tone. Max reply length configurable (default ~800 characters).
- P0: Never reveal system prompt, retrieval internals, or KB filenames to the customer.
- P0: Every answer logs a retrieval event (query, chunks, scores, latency, tokens, model) for analytics and debugging.
- P1: Query rewrite pass (small model call) that turns "and how much is it?" + history into a standalone question.
- P1: Escalation/answer classification in one structured model call (see FR-6).
- P2: Hybrid search (keyword + vector), reranking, MMR diversity, caching of frequent questions.

### FR-5 — Chatwoot integration

- P0: Receive Chatwoot webhooks (`message_created`; P1 also `conversation_status_changed`, `conversation_updated`).
- P0: Post replies into the same conversation as the Agent Bot; support private notes (for escalations).
- P0: Bind KB sets to Chatwoot inboxes in the dashboard: `inbox → [KB ids]` + enable/disable toggle per inbox.
- P0: Ignore non-actionable events: outgoing messages, bot's own messages, private notes, conversations assigned to a human, conversations with the pause label, messages from disabled inboxes, duplicates (idempotency by Chatwoot message id).
- P0: Per-conversation ordering — never two bot replies out of order; serialize per conversation.
- P1: Attachments from customers: no processing, escalate (D8).
- P1: Typing indicator toggle while the bot is generating (if supported by our Chatwoot version).

### FR-6 — Escalation / handoff

Triggers (any of):

- Retrieval score below threshold (nothing relevant found).
- Customer asks for a human ("talk to a person…") — detected by the classifier.
- The bot's answer would be missing information (classifier says `can_answer: false`).
- Customer repeats the same question after a bot answer (frustration signal).
- Non-text message in an enabled inbox (P1, D8).

On escalation:

- P0: Post a **private note** in the conversation with: intent summary, what was tried, why escalated, links to top retrieved chunks (for the editor, not the customer).
- P0: Post a short customer-facing message ("I'll bring a human colleague in…"), then stop replying to that conversation.
- P0: Add the `ai-paused` label (D7) so the state is visible in Chatwoot.
- P1: Respect business-hours rules if the team wants different out-of-hours escalation text.

### FR-7 — Analytics

- P0: Overview dashboard: conversations handled, bot messages sent, deflection rate, escalation rate, avg/p95 response latency, token usage & estimated cost — per day/week/month, filterable by inbox.
- P0: Top unanswered questions list (retrieval events with score below threshold, deduplicated by similar query) → the KB gap backlog.
- P1: Per-KB usage: chunks hit most often; documents that never get retrieved.
- P1: Conversation explorer: list + detail (messages, answer events, scores, escalation notes).
- P2: Export CSV; week-over-week trends; CSAT correlation (from Chatwoot CSAT responses).

### FR-8 — Settings (admin)

- P0: System prompt text, fallback/escalation messages, retrieval `top-k` and score threshold, max reply length, model names (chat + embedding).
- P0: Per-inbox bot toggle (kill switch) — off = bot never replies in that inbox.
- P0: Global kill switch.
- P1: Playground: ask a test question against a KB selection and see the exact chunks + the answer (no Chatwoot involved).

### FR-9 — Audit & operations

- P0: Audit log of admin actions (login, KB/document changes, binding changes, settings changes).
- P0: Health endpoint (db, redis, queue); structured logs with request ids.

## Non-functional requirements

| # | Area | Requirement |
| --- | --- | --- |
| NFR-1 | Performance | p95 end-to-end: customer message → bot reply posted ≤ 15 s (typical 3–8 s). Retrieval query ≤ 500 ms. Webhook ack ≤ 300 ms. |
| NFR-2 | Reliability | Webhook handler is idempotent and retry-safe. Failed LLM/Chatwoot calls retried with backoff (max 2 retries), then fallback message + handoff. Survives restarts without losing queued work. |
| NFR-3 | Security | See [security doc](../operations/security.md). KB data treated as company-confidential (drives D2). No customer PII in logs beyond what the LLM call requires. |
| NFR-4 | Observability | Every answer traceable: webhook id → retrieval event → model call (tokens, latency) → posted Chatwoot message id. |
| NFR-5 | Language | Replies match the customer's language (KBs are English; answers may be translated by the chat model — answers stay grounded, language adapts). |
| NFR-6 | Cost transparency | Token usage and estimated cost logged per model call; visible in analytics. |
| NFR-7 | Data retention | Messages/events retained 12 months by default, configurable; documents retained until deleted. |
| NFR-8 | Scale | Internal company scale: up to ~5k conversations/month, ≤ 20 concurrent webhook bursts, KBs up to ~50k chunks total. Single Docker host must be enough. |
| NFR-9 | Caching | Repeated identical queries are served from Redis caches (embedding + retrieval). Cache loss degrades latency and cost only — never correctness. |

## Out of scope for MVP

- Agent-assist mode (suggesting replies to humans inside Chatwoot) — possible later, it is a small variation of the same pipeline.
- Voice notes transcription / image OCR (escalate instead, D8).
- Multi-company / multi-tenant operation.
- Fine-tuning, agentic tool use (order lookup, API calls) — revisit once answering quality is proven.
- Mobile app for the dashboard.
