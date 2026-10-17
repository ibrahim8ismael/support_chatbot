# Caching (Redis)

Redis has two jobs in this system: the **BullMQ job queue** ([ADR-0006](../decisions/0006-job-queue.md), [message flow](message-flow.md)) and the **application cache** — this doc covers the cache. Rule of thumb: *Redis holds nothing that we could not rebuild; Postgres holds everything durable.*

## What we cache

| Cache | Key | Value | TTL | Invalidated by |
| --- | --- | --- | --- | --- |
| **Embedding** | `emb:v1:{model}:sha256(text)` | vector (float array) | 30 days | Model change (new namespace) or text change (new hash). No explicit deletion needed |
| **Retrieval** | `ret:v1:{kb_versions}:sha256(normalized query)` | scored chunks (content + metadata included, ready for prompting) | 15 min | KB version bump (see below) |
| **Settings** | `settings:v1` | settings snapshot | 60 s + explicit bust on write | Any settings update |
| **Bindings** | `bind:v1:{chatwoot_inbox_id}` | kb ids for the inbox (`[]` = bot off) | 60 s + explicit bust on write | Binding upsert |
| **Rate limits** | `rl:{scope}:{id}` | counter | window (e.g. 15 min) | Expiry |

### KB version counters

Each KB has a counter `kb:{id}:version` in Redis, incremented on any ingestion change (document added/reprocessed/deleted). The retrieval cache key includes the sorted `(kb_id → version)` pairs, so re-ingesting a KB **auto-invalidates** every retrieval cache entry that used it — no `SCAN`/pattern deletes, no stale answers.

### Why these pay off here

- Support traffic is heavily repetitive — the same questions arrive hourly. Embedding the same text again is pure latency + cost.
- Retrieval results only change when the KB or the query changes; both are captured in the key.
- Settings are read on every job; a 60 s cache plus explicit invalidation removes a row read from the hot path.
- Bindings are read on every incoming message (inbox filter); the webhook path needs only the KB list, cached per inbox with an explicit bust on write.
- Login throttling and webhook rate limits need fast shared counters — Redis is the standard fit.

## Where it lives in the code

`infra` module (see [repo structure](repo-structure.md)) exposes:

```ts
interface CacheService {
  get<T>(key: string): Promise<T | undefined>;  // errors logged, treated as misses
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  incr(key: string): Promise<void>;  // KB version counters (no TTL)
  del(key: string): Promise<void>;
}
```

- `retrieval` uses it for `emb:` and `ret:` keys.
- `settings` wraps its reads; writes bust the key.
- `auth` uses it for rate-limit counters (not via `getOrSet` — direct counter ops).

Keep cache logic at the edges of the owning module; **never** cache the final composed prompt or a generated reply (see below).

## What we deliberately do NOT cache (MVP)

| Thing | Why not |
| --- | --- |
| Generated replies | Freshness and politeness depend on conversation context; a stale reply to a new situation is worse than a fresh model call |
| Sessions | They are durable auth state — Postgres ([data model](data-model.md)) |
| Full prompts | Cheap to assemble; caching them hides prompt-version bugs |
| Conversation history | Read from Postgres — the source of truth must stay authoritative |

Reply-level caching for exact-repeat questions (same query, same chunks, short TTL) is a P2 experiment — it must clear the same eval gates as any prompt change.

## Failure behavior

- **Fail-open by design:** any cache read/write error is logged (rate-limited to once per minute) and treated as a miss. A broken cache makes us slower and slightly more expensive — never wrong.
- **Redis fully down:** the caches are moot — the *queue* is also on Redis, so new webhook work is refused (503 → Chatwoot retries) until Redis is back. Dashboard reads keep working from Postgres. Alert + runbook: [deployment § Redis down or full](../operations/deployment.md#redis-down-or-full).
- **After a restore/wipe:** the cache warms itself; no warm-up script needed.

## Ops parameters (prod)

| Setting | Value | Why |
| --- | --- | --- |
| `maxmemory` | 512 MB | generous at our volume; queue + cache together stay well below |
| `maxmemory-policy` | `noeviction` | queue keys must never be evicted; cache keys self-expire via TTL so eviction is not needed to bound memory |
| `appendonly` | `yes` | queue durability across restarts (AOF) |
| Logical DBs | db 0 = queue, db 1 = cache | separation of concerns; one instance (escape hatch: split instances if cache pressure ever threatens the queue) |

Monitoring: `used_memory`, `evicted_keys` (must stay 0), and (P1) hit ratios per cache type.
