# ADR-0003 — Chatwoot Webhook as the Only Channel Integration

- Status: Accepted
- Date: 2026-10-17

## Context

The company runs a self-hosted Chatwoot that already aggregates all customer channels (WhatsApp, website widget, email, Instagram, Telegram, …). The support agent must serve customers on all of those channels. Options: (a) integrate once behind Chatwoot as an Agent Bot (webhook in, REST API out), (b) integrate each channel's provider directly (WhatsApp Business API, email, …), (c) both.

(b) multiplies integrations, credentials, and failure modes; channel semantics (templates, message windows, media types) would leak into our agent logic. Chatwoot exists precisely to normalize this.

## Decision

Integrate with Chatwoot only:

- **Inbound:** Chatwoot Agent Bot webhook → `POST /api/webhooks/chatwoot/:secret` (`message_created` first; more events later).
- **Outbound:** Chatwoot REST API with the bot token (`messages`, `labels`).
- **Control:** per-inbox bindings + labels (`ai-paused`) + assignee detection live in our system and Chatwoot respectively ([contract](../integrations/chatwoot.md)).
- The `chatwoot` module is the only code that speaks HTTP to Chatwoot; the `agent` module decides *content*.

## Consequences

- **Easy:** every channel works on day one and any new channel the company adds to Chatwoot works with zero changes here; one place to handle dedupe/ordering; loops prevented centrally.
- **Hard (accepted):** we inherit Chatwoot's webhook semantics and version quirks — mitigated with fixture contract tests and idempotent handlers; webhooks are unsigned — mitigated per the [security doc](../operations/security.md#3-webhook--integration-surface).
- **Risk:** if the company ever leaves Chatwoot, this module is rewritten — isolated and documented exactly for that reason.
