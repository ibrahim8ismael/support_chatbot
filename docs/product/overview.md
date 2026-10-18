# Product Overview

## Problem

Our support team works entirely out of self-hosted **Chatwoot**, which aggregates every customer channel we use (WhatsApp, web widget, email, Instagram, Telegram…). The pain:

- A large share of incoming questions are repetitive — answered the same way, by a human, hundreds of times.
- First-response time depends on who is online; outside working hours customers wait until morning.
- Answers live in people's heads or scattered across old tickets, so consistency varies between agents.
- Managers have no clean view of *what* customers actually ask and how often we fail to answer.

## What we are building

An **internal support agent** that plugs into Chatwoot as an Agent Bot:

- Customer messages arrive via Chatwoot webhook → we answer with **RAG over curated knowledge bases (KBs)** → the answer is posted back into the same Chatwoot conversation.
- It starts with answers grounded in KB content only. When the answer is not in the KBs, or the customer asks for a human, it **escalates** (posts a summary for the agents, stops replying).
- A **dashboard** (Next.js) lets the team: add KBs and upload documents, bind KBs to inboxes, test answers before going live, watch conversations, and view analytics.

Two model roles:

| Role | Job | Example |
| --- | --- | --- |
| **Embedding model** | Vectorize KB chunks and incoming questions for search | `text-embedding-3-small` (OpenAI, 1536 dims) |
| **Chat model** | Write the final reply in a friendly tone, based only on retrieved KB content | `gpt-4.1-mini` (OpenAI) or any OpenRouter model |

Models are accessed through the **Vercel AI SDK**, so providers can be swapped by config ([details](../integrations/llm-and-vercel-ai-sdk.md)).

## Goals

| # | Goal | Why it matters |
| --- | --- | --- |
| G1 | Deflect repetitive questions automatically | Humans spend time on real problems |
| G2 | 24/7 first response | Customers never wait until morning for common questions |
| G3 | Consistent, correct answers grounded in KBs | No more per-agent variation; nothing invented |
| G4 | Safe escalation to humans | The bot must never trap a customer in a loop |
| G5 | Central, curated knowledge | One place to fix an answer → fixes it everywhere |
| G6 | Measurable impact | Deflection rate, escalations, top unanswered questions |

## Non-goals (for now)

- Replacing human agents — this is a first line, not a full replacement.
- Outbound/marketing messages, voice calls, or a customer-facing app.
- A multi-tenant SaaS — this is internal, single-company, by design.
- Fine-tuning models on our data (revisit after we have real traffic and evals).
- Integrating channels directly — **Chatwoot owns all channels**, we integrate once.

## Users

| Persona | Uses | Needs |
| --- | --- | --- |
| **Customer** (indirect) | WhatsApp/widget/email/… | Fast, correct, friendly answers; easy path to a human |
| **Support agent** | Chatwoot + dashboard (read) | Trustworthy handoffs, context, ability to pause the bot |
| **KB editor** | Dashboard | Upload/replace docs, test what the bot answers, see gaps |
| **Support lead** | Dashboard analytics | Deflection rate, escalation rate, top unanswered topics, trends |
| **Operator (eng/ops)** | Logs, runbooks | Health, deploy, rotate secrets, debug a bad answer |

## Success metrics (targets for the first 3 months live)

| Metric | Target |
| --- | --- |
| Deflection rate (bot resolves, no human needed) | ≥ 40% of eligible conversations |
| Wrong-answer incidents | 0 tolerated at policy level — escalate when unsure (groundedness rules in [RAG pipeline](../architecture/rag-pipeline.md)) |
| First response time | < 30 seconds, any hour |
| Escalation quality | Human never has to re-ask what the customer already said (summary provided) |
| KB hygiene | Top unanswered questions reviewed weekly and either added to a KB or consciously declined |

Metrics definitions and how they are computed: [Requirements § FR-7](requirements.md) and the analytics section of the [REST API doc](../api/rest-api.md).

## Related docs

- Scope in detail: [requirements.md](requirements.md)
- Delivery plan: [roadmap.md](roadmap.md)
- How it works: [architecture/system-overview.md](../architecture/system-overview.md)
