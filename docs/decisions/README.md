# Architecture Decision Records

Short records of decisions that shape the system. Format: **Status / Context / Decision / Consequences**. One file per decision, numbered, never edited after `Accepted` — supersede with a new ADR instead.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-modular-monolith.md) | Modular monolith repo & deployable | Accepted |
| [0002](0002-postgres-pgvector.md) | Postgres + pgvector as the only data store | Accepted |
| [0003](0003-chatwoot-webhook-channel.md) | Chatwoot webhook as the only channel integration | Accepted |
| [0004](0004-rag-pipeline.md) | RAG: in-house thin pipeline vs framework/platform | **Proposed** |
| [0005](0005-vercel-ai-sdk.md) | Vercel AI SDK as the model access layer | Accepted |
| [0006](0006-job-queue.md) | BullMQ + Redis for background jobs & caching | Accepted |

## When to write an ADR

- The decision is costly to reverse (database, integration contract, deploy model).
- A reasonable engineer would ask "why is it like this?" in six months.
- It changes a boundary between modules or services.

Open decisions waiting for ADRs are tracked in [../open-decisions.md](../open-decisions.md).

## Template

```markdown
# ADR-XXXX — Title

- Status: Proposed | Accepted | Superseded by ADR-YYYY
- Date: YYYY-MM-DD

## Context
What forces are in play.

## Decision
What we will do.

## Consequences
What becomes easy, what becomes hard, what we accept.
```
