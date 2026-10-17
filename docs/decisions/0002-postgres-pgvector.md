# ADR-0002 — Postgres + pgvector as the Only Data Store

- Status: Accepted (amended 2026-10-17 — the job queue and caches moved to Redis, see [ADR-0006](0006-job-queue.md))
- Date: 2026-10-17

## Context

We need relational data (users, KBs, documents, conversations, messages, settings) and vector similarity search (chunks, queries). Options: (a) Postgres with pgvector for both, (b) Postgres + a dedicated vector database (Qdrant/Weaviate/Pinecone), (c) a vector DB alone.

Scale check: up to ~50k chunks total for MVP and ~5k conversations/month. HNSW in pgvector handles millions of vectors comfortably at these latencies; metadata filtering (KB ids, inbox bindings) is a trivial WHERE clause in SQL instead of a parallel data-sync problem.

## Decision

Use Postgres 16 with the `pgvector` extension as the single data store:

- `chunks.embedding vector(N)` with an HNSW cosine index; search via `<=>` operator.
- All durable state in one database — the job queue and caches live in Redis ([ADR-0006](0006-job-queue.md)); Postgres holds only what must survive.
- Vector access goes through a `Retriever` interface in the `retrieval` module (raw SQL is fine inside it), so a future vector store swap is contained.

## Consequences

- **Easy:** one system to back up/monitor/restore; joins between chunks and documents/KBs are free; no dual-write consistency problems; transactions across everything.
- **Hard (accepted):** vector tuning (ef_search, index rebuilds) is on us; embedding dimension is locked per deployment ([D3](../open-decisions.md)) — changing models requires a backfill migration (runbook in [deployment](../operations/deployment.md)).
- **Trigger to revisit:** sustained retrieval p95 > 500 ms, or > ~5M chunks, or multi-tenant isolation demands — then swap the `Retriever` implementation.
