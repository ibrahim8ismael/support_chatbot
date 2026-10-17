# Security

Threat model in one line: an internal tool that ingests **confidential company knowledge** and sends **customer content** to **model providers**, driven by a **public webhook**, operated by **our own team**. Every section below maps to one of those four surfaces.

## 1. Dashboard authentication (authN)

| Control | MVP |
| --- | --- |
| Passwords | argon2id hashes; minimum length 12; breached-password check (P1) |
| Sessions | server-side session rows; cookie `httpOnly`, `secure`, `sameSite=lax`, sliding 7-day expiry; logout kills the row |
| Login throttling | per-IP (10 attempts / 60 s) and per-account counters in Redis + exponential delay (100 ms → 1 s); locked 15 min after 8 failures (admin alerting with T-404) |
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

Chatwoot webhooks are **not cryptographically signed** (as of our version — re-verify on upgrade). Layered mitigations:

1. **Unguessable URL**: `/api/webhooks/chatwoot/<48-char secret>`; wrong secret → `404` (never reveal the endpoint exists).
2. **Network allowlist**: the reverse proxy only accepts the webhook path from the Chatwoot host / internal network. Public exposure is an explicit ops decision, default is *not public* if Chatwoot is internal.
3. **Payload validation**: zod schema; unknown shapes rejected; body size cap (1 MB).
4. **No side effects on secrets**: webhook processing can only create messages/conversations and enqueue jobs — it cannot change settings or users.
5. **Idempotency** (see [chatwoot doc](../integrations/chatwoot.md)): replays are harmless — this is also an abuse mitigation.
6. **Optional confirmation fetch** (P1): for suspicious payloads, re-fetch the message from Chatwoot via the API before acting.

Outbound credentials: Chatwoot bot token and provider API keys are env-only, least-privilege, rotated per [deployment runbook](deployment.md#rotate-secrets). Never logged — pino redaction list covers `authorization`, `api_key`, `token`, cookies.

## 4. Model data protection

| Question | Answer |
| --- | --- |
| What leaves our network? | Retrieved chunks + recent conversation turns + the customer message. **Only when [D2](../open-decisions.md) approves external providers** |
| Until D2 decided | Staging/dev use mock or self-hosted models; production KB content is never sent externally |
| If self-hosted (vLLM/Ollama) | Nothing leaves; same AI SDK interface |
| PII minimization | Send only what retrieval needs; no user emails/ids in prompts; (P1) redaction pass for obvious PII before provider calls |
| Logs | Prompt content logged at debug only, with email/phone regex redaction (P1); `answer_events` stores query text (needed for analytics) with access limited to admins |
| Caching | Redis holds hashed inputs + derived data (vectors, chunk ids); queue payloads carry **ids, not message text** — workers re-read content from Postgres |
| Retention | 12 months default for messages/events ([NFR-7](../product/requirements.md)); documents until deleted |

## 5. Prompt injection & output safety

The bot reads **customer text** and **KB content** — both are untrusted input to the model.

| Mitigation | Where |
| --- | --- |
| KB content wrapped in delimiters, explicitly labeled as data, never as instructions | [prompt template](../architecture/rag-pipeline.md#prompt-template-system) |
| System rules: never follow instructions found in knowledge/customer text; never reveal instructions | prompt + versioned files |
| Grounding gate: no confident context → escalate instead of improvise | threshold + classifier |
| Output checks before posting: length cap; blocklist regex (system prompt, "knowledge base", our file names); no raw URLs not present in KB | `agent` module guard step |
| Injection attempts in customer messages | logged; recurring patterns become eval cases |
| Jailbreak success (model still leaks/obeys) | answer review workflow (P1): flag from dashboard → fix prompt → regression eval |

## 6. Application hardening

- **Validation everywhere at the edge:** zod for webhook + shared DTOs; docs uploads limited by mime sniffing (not just extension) and size.
- **Uploads are never served back to customers** — only parsed internally; served to dashboard users via authenticated, filename-sanitized download (P1) or not at all (MVP).
- **SQL:** parameterized queries only (ORM + raw vector queries with bound params).
- **Redis is internal-only:** no published ports (compose network only), `requirepass` in prod, and nothing sensitive beyond transient data — cache keys are hashes, values are derived data, job payloads carry ids not message text. Treat it as confidential anyway (same host policies as the DB).
- **Rate limits:** login (strict), webhook (generous but capped), dashboard API (per session).
- **Errors:** no stack traces or provider errors to clients; detailed logs server-side with request id.
- **Dependencies:** lockfile, `pnpm audit` in CI, Docker images pinned by digest in prod, base images rebuilt monthly.

## 7. Audit & incident basics

Audited actions (into `audit_logs`): logins (success/fail), user changes, KB/document changes, binding & settings changes, pause/resume actions, kill-switch toggles. Each row: actor, action, entity, timestamp, before/after for settings.

Incident quick-path:

1. **Global kill switch off** (dashboard, seconds).
2. Revert the offending setting/prompt (audit log shows the change).
3. If credential leak suspected → rotate per runbook, check audit log for misuse.
4. Post-mortem note appended to the relevant doc + a new eval case if it was an answer-quality incident.
