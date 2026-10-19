# ADR-0006 — BullMQ + Redis for Background Jobs and Caching

- Status: Accepted
- Date: 2026-10-17

## Context

The pipeline needs durable background work: reply jobs (retrieve → classify → generate → post), document ingestion (parse → chunk → embed, slow and batchy), retries with backoff, and per-conversation ordering. We also want request-level caching (repeated FAQ questions, re-embedding identical text) to cut latency and model cost. Options:

| Option | Pros | Cons |
| --- | --- | --- |
| (a) pg-boss (Postgres-backed) | No new service; same DB to back up | Polls Postgres; couples queue load to the DB |
| (b) **BullMQ + Redis** | Mature queue: retries, backoff, scheduling, job events; **Redis also serves as our cache**, so one new service covers both needs | One more service to run/secure/monitor; memory discipline required |
| (c) In-process only (no queue) | Zero infra | Lost work on restarts; no retries; the webhook must not do work inline anyway |

Redis is entering the stack for **caching** regardless (embedding cache, retrieval cache, settings cache, rate-limit counters — see [caching](../architecture/caching.md)). With Redis present, BullMQ is the natural queue choice and keeps queue load out of Postgres. An earlier draft of this ADR proposed pg-boss; the decision flipped when caching made Redis a given.

## Decision

- **Queue: BullMQ on Redis.** Queues: `reply-job`, `ingest-document`, `analytics-followup`; plus repeatable jobs for cron tasks (weekly digest, cleanup).
- **Per-conversation serialization:** deterministic `jobId = reply:<conversation_id>` (a second enqueue for the same conversation is coalesced) + a Redis lock (`SET NX PX`, renewed) held while processing. The worker re-reads the conversation before finishing and re-enqueues itself if newer messages arrived.
- **Reliability:** `attempts: 3` with exponential backoff; failed jobs retained for inspection with bounded retention (failed 7 days / 1000; completed 1 day / 1000) so the `noeviction` Redis cannot fill up; queue events feed logs and metrics. AOF persistence on (`appendonly yes`) so queued/running jobs survive restarts.
- **Caching: same Redis instance, logical databases.** db 0 = queue, db 1 = cache. Prod: `maxmemory` capped, **`noeviction`** — queue keys must never be evicted; every cache key carries a TTL so memory self-bounds.
- **Failure behavior:** the queue is a hard dependency (if enqueue fails: webhook answers 503 so Chatwoot retries — never lose a message). The cache is **fail-open** (errors are logged and treated as misses; answers degrade to uncached, never to wrong).
- Workers run inside `apps/api` ([ADR-0001](0001-modular-monolith.md)); extraction to `apps/worker` later is a packaging change.

## Consequences

- **Easy:** durable retries, backoff, and scheduling without burdening Postgres; one Redis serves queue + cache; job states (`waiting/active/failed`) are observable out of the box; cache eviction and invalidation are code-owned and tested.
- **Hard (accepted):** one more service to run/secure/monitor (small — 512 MB covers both roles at our volume); a Redis outage pauses *new* bot answers (dashboards keep working; Chatwoot retries; alert fires); memory discipline needed (`noeviction` + TTLs).
- **Watch:** if cache pressure ever threatens queue stability, split queue and cache onto separate Redis instances — that is the documented escape hatch, not a redesign.
