# Security

Threat model in one line: an internal tool that ingests **confidential company knowledge** and sends **customer content** to **model providers**, driven by a **public webhook**, operated by **our own team**. Every section below maps to one of those four surfaces.

## 1. Dashboard authentication (authN)

| Control | MVP |
| --- | --- |
| Passwords | argon2id hashes; minimum length 12; breached-password check (P1) |
| Sessions | server-side session rows; cookie `httpOnly`, `secure`, `sameSite=lax`, sliding 7-day expiry; logout kills the row |
| Login throttling | atomic Redis counters (Lua `INCR`+`EXPIRE`, fail-open): per-IP 10 attempts / 60 s, per-account burst cap 5 / 10 s, lockout 15 min after 8 failures **per (account, source address)** + exponential delay (100 ms → 1 s); denials are audited at most once per reason+subject per minute so a flood cannot grow `audit_logs`; `trust proxy` trusts exactly one hop (compose Caddy); locked accounts surfaced by T-404 alerting |
| SSO | [D4](../open-decisions.md) — adds OIDC later behind the same session layer |
| Session hygiene | invalidate all sessions when a user is deactivated or their password changes |

## 2. Authorization (authZ)

Roles and capabilities:

| Capability | viewer | editor | admin |
| --- | --- | --- | --- |
| View KBs, documents, conversations, analytics | ✅ | ✅ | ✅ |
| Upload/reprocess/delete documents | — | ✅ | ✅ |
| Create/archive KBs, manage bindings | — | ✅ | ✅ |
| Change settings (prompts, thresholds, toggles) | — | ✅ | ✅ |
| Manage users, view audit logs | — | — | ✅ |
| Kill switches | — | ✅ | ✅ |

Enforced with NestJS guards (`RolesGuard`) at controller level; **every** new endpoint states its role explicitly — default is `admin`.

## 3. Webhook & integration surface

Chatwoot v4.13+ signs Agent Bot webhook deliveries (`X-Chatwoot-Signature`:
HMAC-SHA256 over `{X-Chatwoot-Timestamp}.{raw body}`, plus the timestamp
header). The handler verifies the signature when
`CHATWOOT_WEBHOOK_SIGNING_SECRET` is set, including a five-minute timestamp
window. Older unsigned versions can use the path secret alone. Signed requests
are rejected if no signing key is configured. These layers protect the route:

1. **Unguessable URL** (implemented): `/api/webhooks/chatwoot/<long random secret>`; wrong secret → `404` (never reveal the endpoint exists).
2. **Network allowlist**: the reverse proxy only accepts the webhook path from the Chatwoot host / internal network. Public exposure is an explicit ops decision, default is *not public* if Chatwoot is internal.
3. **Payload validation** (implemented): supported payload fields are parsed with zod; unknown event types are acknowledged and ignored; malformed supported events are rejected.
4. **No side effects on secrets**: webhook processing can persist messages/conversations and enqueue jobs — it cannot change settings or users.
5. **Idempotency** (implemented): message ids are unique in the database and webhook jobs use a stable message key; completed answer events with a linked outgoing message suppress common replay paths.
6. **Residual delivery window**: Chatwoot's send and our Postgres write cannot be one transaction. A crash after Chatwoot accepted a reply but before our DB link is saved can cause an uncertain retry; inspect the failed job and Chatwoot thread before replaying it.

Outbound credentials: Chatwoot bot token and provider API keys are env-only, least-privilege, rotated per [deployment runbook](deployment.md#rotate-secrets). Never logged — pino redaction list covers `authorization`, `api_key`, `token`, cookies.

## 4. Model data protection

| Question | Answer |
| --- | --- |
| What leaves our network? | Retrieved chunks + recent conversation turns + the customer message — sent to the selected model provider. [D2](../open-decisions.md) is **Decided (2026-10-18): external APIs — OpenAI + OpenRouter**, with Gemini (2026-10-20) and Google Vertex AI (2026-10-21) as alternate chat carriers |
| With external providers | OpenAI: chat + embeddings (`text-embedding-3-small`); OpenRouter, Gemini and Vertex: chat only. Dev/CI keep `LLM_PROVIDER=mock` — nothing leaves |
| If the policy changes | A self-hosted (vLLM/Ollama) carrier is a new factory `case` behind the same AI SDK interface; no pipeline refactor |
| PII minimization | Send only what retrieval needs; no user emails/ids in prompts; (P1) redaction pass for obvious PII before provider calls |
| Logs | Prompt content logged at debug only, with email/phone regex redaction (P1); `answer_events` stores query text (needed for analytics) with access limited to admins — `/analytics/unanswered`, the answer-event block of `/conversations/:id` (T-303), and the audit log are admin-only (T-302/T-304); the aggregate analytics endpoints and the conversation thread itself carry no query text and are open to all signed-in roles |
| Caching | Redis holds hashed inputs + derived data (vectors, chunk ids); queue payloads carry **ids, not message text** — workers re-read content from Postgres |
| Retention | 12 months default for messages/events ([NFR-7](../product/requirements.md)); documents until deleted |

## 5. Prompt injection & output safety

The bot reads **customer text** and **KB content** — both are untrusted input to the model.

| Mitigation | Where |
| --- | --- |
| KB content wrapped in delimiters, explicitly labeled as data, never as instructions; `<kb>`-marker lookalikes in chunk content neutralized (`&lt;/kb>`) so a document cannot break out of its block | [prompt template](../architecture/rag-pipeline.md#prompt-template-system) + renderer |
| System rules: never follow instructions found in knowledge/customer text; never reveal instructions | prompt + versioned files |
| Grounding gate: no confident context → escalate instead of improvise | threshold + classifier |
| Output checks before posting: length cap; blocklist regex (system prompt, "knowledge base", our file names); no raw URLs not present in KB | `agent` module guard step |
| Injection attempts in customer messages | logged; recurring patterns become eval cases |
| Jailbreak success (model still leaks/obeys) | answer review workflow (P1): flag from dashboard → fix prompt → regression eval |

## 6. Application hardening

- **Validation everywhere at the edge:** zod for webhook + shared DTOs; docs uploads limited by mime sniffing (not just extension) and size, and parsing runs in a supervised child process with memory/time/output budgets — decompression bombs fail the document instead of the API.
- **Uploads are never served back to customers** — only parsed internally; served to dashboard users via authenticated, filename-sanitized download (P1) or not at all (MVP).
- **SQL:** parameterized queries only (ORM + raw vector queries with bound params).
- **Redis is internal-only:** no published ports (compose network only), `requirepass` in prod (compose requires `REDIS_PASSWORD`; dev compose runs without auth on localhost), and nothing sensitive beyond transient data — cache keys are hashes, values are derived data, job payloads carry ids not message text. Treat it as confidential anyway (same host policies as the DB).
- **Rate limits:** login (strict), webhook (generous but capped), dashboard API (per session).
- **Errors:** no stack traces or provider errors to clients; detailed logs server-side with request id.
- **Dependencies:** lockfile, `pnpm audit` in CI, Docker images pinned by digest in prod, base images rebuilt monthly.

## 7. Audit & incident basics

Audited actions (into `audit_logs` through the analytics writers, T-301): logins (success/fail), KB/document changes, binding & settings changes, user create/update/password-reset (T-304), and Sandbox case/run/review changes (`sandbox.*`). Per-inbox kill-switch toggles are binding updates and are covered. Conversation pause/resume controls are implemented but are not yet written to the audit log (remaining T-204 work). Each audit row carries actor, action, entity, timestamp, and before/after for settings.

Incident quick-path:

1. **Global kill switch off** (dashboard, seconds).
2. Revert the offending setting/prompt (audit log shows the change).
3. If credential leak suspected → rotate per runbook, check audit log for misuse.
4. Post-mortem note appended to the relevant doc + a new eval case if it was an answer-quality incident.
