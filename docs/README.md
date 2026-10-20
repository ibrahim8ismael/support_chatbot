# Support Agent — Documentation

Internal AI support agent. It answers customer messages that arrive through our self-hosted **Chatwoot** (which already covers all of our channels — WhatsApp, web widget, email, Instagram, Telegram, etc.), using **RAG over company knowledge bases**, and escalates to a human when it is not confident.

The system has two model roles:

1. **Embedding model** — turns knowledge base content and user questions into vectors for search.
2. **Chat model** — writes the final, friendly reply to the customer.

> **Status:** these docs describe the system we are about to build. They are the design source of truth until the code exists; after that, code and docs must be kept in sync.

Last updated: 2026-10-17

---

## Where to start

New to the project? Read in this order:

1. [Product overview](product/overview.md) — what we are building and why
2. [System overview](architecture/system-overview.md) — how the pieces fit together
3. [Message flow](architecture/message-flow.md) — what happens when a customer message arrives
4. [Open decisions](open-decisions.md) — what is still undecided

## Documentation map

### Product

| Doc | Description |
| --- | --- |
| [Product overview](product/overview.md) | Problem, goals, target users, success metrics |
| [Sandbox](product/sandbox.md) | Owner-facing accuracy testing: saved cases, scored runs, review |
| [Requirements](product/requirements.md) | Functional and non-functional requirements (MVP scope) |
| [Roadmap](product/roadmap.md) | Phases, milestones, risks |

### Architecture

| Doc | Description |
| --- | --- |
| [System overview](architecture/system-overview.md) | Components, principles, deployment view |
| [Repo structure](architecture/repo-structure.md) | Modular monolith repo layout and module boundaries |
| [Tech stack](architecture/tech-stack.md) | Stack choices, versions, rationale |
| [Data model](architecture/data-model.md) | Database schema, pgvector usage |
| [RAG pipeline](architecture/rag-pipeline.md) | Ingestion, chunking, embedding, retrieval, prompts |
| [Caching](architecture/caching.md) | Redis cache design: keys, TTLs, invalidation, failure behavior |
| [Message flow](architecture/message-flow.md) | End-to-end lifecycle of a customer conversation |

### Integrations

| Doc | Description |
| --- | --- |
| [Chatwoot](integrations/chatwoot.md) | Webhooks, Agent Bot, reply API, handoff mechanics |
| [LLM providers & Vercel AI SDK](integrations/llm-and-vercel-ai-sdk.md) | Model abstraction, provider config, prompts |

### API & operations

| Doc | Description |
| --- | --- |
| [REST API](api/rest-api.md) | Dashboard API design, webhook endpoint, errors |
| [Deployment](operations/deployment.md) | Docker, environments, env vars, runbooks |
| [Security](operations/security.md) | AuthN/Z, webhook security, data protection, prompt injection |

### Contributing

| Doc | Description |
| --- | --- |
| [Development](contributing/development.md) | Local setup, scripts, testing, conventions |
| [Build plan](contributing/build-plan.md) | Ticket-level execution list (M0–M4) with acceptance criteria |

### Decisions (ADRs)

| Doc | Status |
| --- | --- |
| [ADR index](decisions/README.md) | — |
| [0001 — Modular monolith](decisions/0001-modular-monolith.md) | Accepted |
| [0002 — Postgres + pgvector](decisions/0002-postgres-pgvector.md) | Accepted |
| [0003 — Chatwoot as the channel](decisions/0003-chatwoot-webhook-channel.md) | Accepted |
| [0004 — RAG pipeline approach](decisions/0004-rag-pipeline.md) | **Proposed** |
| [0005 — Vercel AI SDK as model layer](decisions/0005-vercel-ai-sdk.md) | Accepted |
| [0006 — BullMQ + Redis queue/cache](decisions/0006-job-queue.md) | Accepted |

## Conventions used in these docs

- **Status labels** on decisions: `Proposed` → `Accepted` → `Superseded`. Open questions are tracked in [open-decisions.md](open-decisions.md) with IDs like `D3`.
- **Diagrams** are written in [Mermaid](https://mermaid.js.org/) so they render on GitHub/GitLab.
- **Terminology** follows the [glossary](glossary.md). "KB" means knowledge base. "Conversation" means a Chatwoot conversation.
- **Policy:** if a doc and the code disagree, the code wins — then fix the doc (or the code) in the same PR.

## Editing these docs

- Keep one topic per file; link instead of duplicating.
- When a decision is made, update the matching ADR and the table in [open-decisions.md](open-decisions.md).
- Docs changes ship in the same PR as the code they describe.
