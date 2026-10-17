# Chatwoot Integration

Chatwoot is our **only** channel integration: every channel the company supports (WhatsApp, website widget, email, Instagram, Telegram, …) is connected to Chatwoot, and we sit behind it as an **Agent Bot**. This doc is the contract with Chatwoot; adjust it against our exact Chatwoot version when we verify in Phase 0.

- Webhook: Chatwoot → us (`message_created`)
- Replies: us → Chatwoot REST API (bot token)
- Ownership of channel specifics: Chatwoot, always.

## Setup (per environment)

1. In Chatwoot (Agent Bots admin section), create an Agent Bot named e.g. `Support Agent (staging)`.
   - Webhook URL: `https://<our-api-host>/api/webhooks/chatwoot/<WEBHOOK_SECRET>` — the secret is a long random path segment and is environment-specific.
   - Save the generated **bot access token** → `CHATWOOT_BOT_TOKEN`.
2. Subscribe the bot webhook to events: `message_created` (P0); later `conversation_status_changed`, `conversation_updated` (P1).
3. Assign the bot to the inboxes it should serve (inbox settings → Agent Bot). Which inboxes get **answers** is then controlled by us in `inbox_bindings` (belt and braces: both must be on).
4. Config values we need ([deployment § env](../operations/deployment.md)):

| Variable | Meaning |
| --- | --- |
| `CHATWOOT_BASE_URL` | e.g. `https://chatwoot.internal.company` |
| `CHATWOOT_ACCOUNT_ID` | numeric account id (visible in URLs) |
| `CHATWOOT_BOT_TOKEN` | Agent Bot access token from step 1 |
| `CHATWOOT_WEBHOOK_SECRET` | random string in the webhook path |

## Incoming: webhook contract

`POST /api/webhooks/chatwoot/:secret` — public endpoint, no session. Handler rules: verify secret path → parse with zod → **respond 200 fast** → process async (queue). Never do model calls inside the webhook request.

Representative payload (fields abbreviated; verify against our version):

```json
{
  "event": "message_created",
  "id": 4291,
  "content": "how much is the annual plan?",
  "message_type": "incoming",
  "content_type": "text",
  "created_at": "2026-10-17T08:12:04.000Z",
  "private": false,
  "sender": { "id": 55, "name": "Sara", "type": "contact" },
  "conversation": {
    "id": 812,
    "inbox_id": 3,
    "status": "open",
    "assignee_id": null,
    "labels": [],
    "meta": { "sender": { "id": 55 } }
  },
  "account": { "id": 1 }
}
```

### Filter matrix (any fail → ignore)

| Condition | Why |
| --- | --- |
| `event != "message_created"` | MVP scope (others logged only) |
| `message_type != "incoming"` | Never react to outgoing (incl. our own replies — loop prevention) |
| `private == true` | Private notes are agent-only |
| `sender.type != "contact"` | System/template messages |
| Inbox not in `inbox_bindings` or `enabled=false` | Per-inbox control |
| `settings.bot_enabled=false` | Global kill switch |
| Conversation has label `ai-paused` | Explicit human override (D7) |
| Conversation assigned to a human | Implicit human takeover (D7) |
| `content_type != "text"` | MVP: escalate instead of ignore for voice/image (D8, P1) |

Loop safety is a hard requirement: the bot's own replies come back as `outgoing` webhooks. Two independent defenses (filter + sender type) must both fail before a loop is possible.

### Idempotency

`messages.chatwoot_message_id` is UNIQUE. Webhook retries hit `ON CONFLICT DO NOTHING` — a message is processed exactly once, whatever Chatwoot does on delivery failures. Reply jobs are keyed per conversation ([message flow](../architecture/message-flow.md#step-by-step-webhook-side)).

## Outgoing: replies via the Chatwoot API

All calls use `api_access_token: <CHATWOOT_BOT_TOKEN>` and go through the `chatwoot` module only. In code, every call goes through one shared **axios** instance owned by this module (`baseURL = CHATWOOT_BASE_URL`, `timeout: 10 s`, interceptors add the token header and structured logging). No other module creates HTTP clients for Chatwoot — timeout, retry, and telemetry policy live in one place.

**Reply to customer:**

```http
POST {CHATWOOT_BASE_URL}/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages
api_access_token: {CHATWOOT_BOT_TOKEN}
Content-Type: application/json

{ "content": "The annual plan is …", "message_type": "outgoing" }
```

**Private note (handoff summary):**

```json
{ "content": "🤖 Escalated: …summary…", "message_type": "outgoing", "private": true }
```

**Label (pause control):**

```http
POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/labels
{ "labels": ["ai-paused"] }
```

**Attachments (P2):** upload to `/api/v1/accounts/{account_id}/conversations/{conversation_id}/messages` as multipart; not needed for MVP (we send text only).

Notes:

- These are the *headless/bot* message endpoints; confirm exact paths and payloads against our Chatwoot version's API docs before coding (they have changed between minor versions).
- Our messages appear as the Agent Bot in the conversation — customers see a normal agent-side message.
- P1 nicety: toggle typing status while generating, if the endpoint exists in our version; never block a reply on it.

## Conversation & handoff semantics

| Chatwoot concept | Our interpretation |
| --- | --- |
| `conversation.status = open/pending/resolved` | Informational for us; we answer in `open` and `pending` (a "pending" unresolved thread may just be awaiting the customer). `resolved` → `bot_state` irrelevant until a new incoming message reopens it |
| Human `assignee_id` set | Implicit pause — do not answer (D7) |
| Label `ai-paused` | Explicit pause — do not answer, regardless of assignee |
| Label `ai-escalated` (P1, written by us) | Useful in Chatwoot views to filter bot work; optional |
| CSAT messages | Pass through untouched; surface CSATable data in analytics later (P2) |

## Reliability

- **Webhook response:** always 200 quickly, even for ignored/duplicate events. Errors during our *processing* go to the queue, not to Chatwoot's retry loop — with one exception: if enqueueing itself fails (Redis unavailable), respond 503 so Chatwoot redelivers instead of the message being lost.
- **Chatwoot retries** failed deliveries — we are idempotent, so retries are harmless.
- **Our outbound calls:** timeout 10 s, retry 2× with backoff (idempotency note: message posts cannot be made idempotent server-side; we accept at-most-once with a double-send guard comparing the last bot message).
- **Ordering:** guaranteed per conversation by the deterministic BullMQ jobId + a per-conversation Redis lock held while processing ([message flow](../architecture/message-flow.md#step-by-step-webhook-side)).
- **Rate limits:** self-hosted Chatwoot has none by default; we still send at most one reply per incoming message and use a worker pool of 4.
- **Network:** if Chatwoot and Support Agent are on the same Docker network, use the internal URL; otherwise company-internal DNS + TLS.

## Security (details in [security doc](../operations/security.md))

- **Chatwoot webhooks are not cryptographically signed** (verify for our version — this may change). Mitigations, all applied: long random secret in the path, HTTPS only, network-level access control (only Chatwoot host/IP can reach the endpoint at the proxy), zod validation, and — for high-risk flows — optional re-fetch of the message via the API to confirm it exists before answering.
- Bot token is environment-scoped and least-privilege (only what the Agent Bot API allows). Rotate by creating a new bot token and updating env (runbook in [deployment](../operations/deployment.md)).
- Never log full webhook payloads at info level (they contain customer content).

## Testing the integration

- **Unit/fixtures:** keep real captured payloads (anonymized) in `apps/api/test/fixtures/chatwoot/` and run the filter matrix against them. This is our contract test — it catches version drift early.
- **Local e2e:** run a dev Chatwoot via its docker-compose, create an Agent Bot pointing to a tunnel (`cloudflared`/`ngrok`) of the local API, use the website widget to send messages.
- **Webhook simulator:** `POST /api/webhooks/chatwoot/:secret` accepts the same payloads from a script — lets us exercise the full pipeline (retrieval, model calls, reply post) without a live Chatwoot, with the outbound call pointed at a mock server in tests.

## Open questions

- Exact Chatwoot version in production → verify payload fields & bot API paths (Phase 0 deliverable).
- Does our version emit `conversation_updated` reliably for the label/assignee pause (D7)? If not, MVP fallback: check assignee/labels via API call at reply time (one extra request per answer — acceptable).
