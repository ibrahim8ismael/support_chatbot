# Deployment

Everything runs in Docker on a single internal host, next to (or near) the existing Chatwoot stack. Target: `docker compose up` on a clean machine gets a working system.

## Services

```mermaid
flowchart LR
    subgraph host [Internal VM / host]
        PROXY[Caddy :443]
        WEB[web<br/>Next.js]
        API[api<br/>NestJS + BullMQ workers]
        PG[(postgres<br/>pgvector/pgvector:pg16)]
        REDIS[(redis<br/>BullMQ + cache)]
        VOL[/uploads volume/]
        PROXY --> WEB
        PROXY --> API
        API --> PG
        API --> REDIS
        API --> VOL
    end
    CW[Chatwoot stack<br/>existing, separate] -->|webhook| PROXY
    API -->|REST replies| CW
    TEAM[Team browser] --> PROXY
```

| Service | Image | Ports | Notes |
| --- | --- | --- | --- |
| `proxy` | `caddy:2` | 80/443 | internal-CA TLS; the only published ports in the stack |
| `web` | built from `apps/web` | internal | Next.js production server |
| `api` | built from `apps/api` | internal | NestJS: REST + webhook + BullMQ workers; starts only after `migrate` exits 0 |
| `migrate` | one-shot of the api image | — | applies the forward-only Drizzle migrations on every deploy |
| `postgres` | `pgvector/pgvector:pg16` | internal | volume `pgdata`; extension `vector` enabled by migration |
| `redis` | `redis:7-alpine` | internal | BullMQ queue (db 0) + cache (db 1); AOF on; `maxmemory` capped, `noeviction`; no published ports |

Dev compose (`docker/docker-compose.yml`) is the same minus proxy/TLS/migrate, plus hot reload. Prod (`docker/docker-compose.prod.yml`) adds Caddy TLS in front, a one-shot `migrate` before `api`, an uploads volume, digest-pinned runtime images, and publishes nothing but 80/443.

## Resource guide (starting point)

| Service | CPU | RAM |
| --- | --- | --- |
| api (+workers) | 2 vCPU | 2 GB |
| web | 1 vCPU | 512 MB |
| postgres | 2 vCPU | 4 GB (HNSW index fits easily at our scale) |
| redis | 1 vCPU | 512 MB |
| host total | 4 vCPU | 8 GB |

## Environment variables

Validated at boot with zod — the API refuses to start with a bad/missing env (fail fast, not at 3 AM).

| Variable | Example | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `APP_URL` | `https://support-agent.internal.company` | used in cookies/CORS |
| `DATABASE_URL` | `postgres://sa:…@postgres:5432/support_agent` | |
| `REDIS_URL` | `redis://redis:6379` | BullMQ queue (db 0) + cache (db 1) — see [caching](../architecture/caching.md) |
| `AUTH_SESSION_SECRET` | 64-char random | session cookie signing |
| `CHATWOOT_BASE_URL` | `https://chatwoot.internal.company` | |
| `CHATWOOT_ACCOUNT_ID` | `1` | |
| `CHATWOOT_BOT_TOKEN` | `xxxxx` | Agent Bot token |
| `CHATWOOT_WEBHOOK_SECRET` | 48-char random | path segment of our webhook URL |
| `LLM_PROVIDER` | `mock \| openai \| openrouter` | [LLM doc](../integrations/llm-and-vercel-ai-sdk.md) |
| `OPENAI_API_KEY` | — | chat + embeddings (`openai`); embeddings only under `openrouter` (D3) |
| `OPENROUTER_API_KEY` | — | chat when `LLM_PROVIDER=openrouter` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | must match ingestion (D3) |
| `CHAT_MODEL` | `gpt-4.1-mini` | |
| `COMPANY_NAME` | `Acme Support` | fills `{{company_name}}` in the answer prompt |
| `DIGEST_WEBHOOK_URL` | `https://hooks.slack.com/services/…` | weekly top-unanswered digest target (see below); Slack-compatible `{"text": …}`; unset → logged only |
| `UPLOAD_DIR` | `/data/uploads` | mounted volume |
| `LOG_LEVEL` | `info` | |
| `WORKER_CONCURRENCY` | `4` | reply job pool size |

Secrets live in `.env` **only on the host** (or docker secrets) — never in the repo, never in the settings table. `.env.example` in the repo documents names without values.

Compose-level values live in the same repo-root `.env` (template: `docker/.env.prod.example`): `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`, `SITE_ADDRESS` (the Caddy site address + TLS certificate name) and `NEXT_PUBLIC_API_URL` (public dashboard origin, baked into the web build — rebuilding `web` is required when it changes).

## Scheduled jobs

No host cron needed: the API schedules its own repeatable jobs on Redis (BullMQ).
The weekly top-unanswered digest is upserted at every boot as a job scheduler —
Mondays 09:00 UTC on the `analytics-followup` queue — and posts the trailing week's
clustered questions to `DIGEST_WEBHOOK_URL` (Slack-compatible; retried 3× with
backoff, failed runs stay inspectable on the queue). Without the webhook the digest
is written to the API log instead.

## Deploy & migrate

One compose file, one API image: the image also carries the one-shot `migrate` command, so schema and code always deploy together. CI builds both images on every change (the Dockerfiles must keep building); images are built on the host for now — a registry push is a later hardening step.

**Clean host:**

1. Install Docker + compose; clone the repo.
2. `cp docker/.env.prod.example .env` and fill in the secrets (see § Environment variables).
3. Build and start the whole stack:

   ```sh
   docker compose --env-file .env -f docker/docker-compose.prod.yml up -d --build
   ```

   Compose runs the pending Drizzle migrations in the one-shot `migrate` service first; `api` starts only after it exits 0 (forward-only migrations, reviewed like code). The `api` healthcheck gates `web` and `proxy`.
4. Create the first admin (a random password is printed once):

   ```sh
   docker compose --env-file .env -f docker/docker-compose.prod.yml \
     run --rm api node dist/cli/seed-admin.js --email admin@company.com
   ```

5. Trust the internal CA (Caddy issues the certificate for `SITE_ADDRESS`):

   ```sh
   docker compose --env-file .env -f docker/docker-compose.prod.yml \
     exec proxy cat /data/caddy/pki/authorities/local/root.crt > caddy-root.crt
   ```

   Install `caddy-root.crt` on team machines — or point `docker/Caddyfile` at real certificates (`tls /certs/…`) / a public domain and drop `tls internal`.
6. Verify: `curl -k https://$SITE_ADDRESS/health` → `{"status":"ok",…}`; log in at `https://$SITE_ADDRESS/login`.

**Updates:** `git pull`, then the same `up -d --build` command: a fresh `migrate` runs first, `api` restarts after it, and web/proxy are recreated only when their inputs changed. Changing `SITE_ADDRESS` or `NEXT_PUBLIC_API_URL` requires a `web` rebuild (the API origin is baked into the Next build) — the same command covers it.

No blue/green for MVP (internal tool, tiny user base): a ~10 s gap while `api` restarts is acceptable; Redis AOF keeps queued jobs across restarts.

## Backup & restore

**Nightly** (host cron or backup agent) — run from the repo root, send both files to the company backup target:

```sh
docker compose --env-file .env -f docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U sa -d support_agent -Fc > support-agent-$(date +%F).dump

docker run --rm -v support-agent_uploads:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/support-agent-uploads-$(date +%F).tgz -C /data .
```

`pgvector` data is inside the dump — nothing special. Retention: 30 daily + 12 monthly dumps. **Redis is not backed up on purpose** — caches rebuild themselves and queue state is transient (AOF survives container restarts, not disasters).

**Restore drill:** before go-live, then quarterly — load the newest dump + uploads tar into a scratch stack (same compose file, a different project name, on a spare host or with the prod stack stopped so ports are free) following § Restore from backup, and end with `/health` + one playground query.

## Runbooks

### Bot not replying

1. `GET /health` on the api — check the `db` and `redis` fields. Container healthy? If redis is down, see the [Redis runbook](#redis-down-or-full).
2. Chatwoot: is the Agent Bot assigned to the inbox? Inbox binding enabled in dashboard? Global kill switch on?
3. Conversation in Chatwoot: label `ai-paused` or human assignee set?
4. Logs: filter `webhook` request id — did the webhook arrive? Did it pass filters? Any `outcome=error` events?
5. Queue state: BullMQ `waiting/active/failed` counts (logs/metrics) — workers stuck on a slow LLM call? A pile of `failed` replies → inspect the failure reason in the queue.

### Re-ingest a document

Dashboard → KB → document → Reprocess. Behind the scenes: queue job; watch status flip `processing → ready/failed`. If repeated failure: check parse error in `documents.error`; try converting the file to a cleaner PDF/text and upload as a new document.

### Redis down or full

1. Container: `docker compose ps redis` → restart if unhealthy; check logs for OOM or persistence errors.
2. Memory: `INFO memory` — `maxmemory-policy` must be `noeviction`; cache keys all carry TTLs, so usage stays bounded. If it filled up anyway: restart (AOF replays), then raise `maxmemory` (512 MB is generous at our volume).
3. While Redis is down: webhooks answer 503 and Chatwoot retries; dashboards still work (Postgres). After recovery, verify the retried webhooks landed — no duplicate replies (idempotency guards).
4. If pressure keeps recurring: split queue and cache onto separate Redis instances (documented escape hatch in [ADR-0006](../decisions/0006-job-queue.md)).

### Rotate secrets

Every rotation = edit `.env` on the host → recreate only the API:

```sh
docker compose --env-file .env -f docker/docker-compose.prod.yml up -d api
```

| Secret | Steps |
| --- | --- |
| `CHATWOOT_BOT_TOKEN` | Create a new bot token in Chatwoot → `.env` → recreate `api` → verify one answer in a test inbox → delete the old token |
| `AUTH_SESSION_SECRET` | `.env` → recreate `api`. It is validated at boot but does not sign cookies yet, so live sessions are unaffected — to force a global sign-out, delete the session rows: `… exec -T postgres psql -U sa -d support_agent -c 'delete from sessions'` (all cookies answer 401; the team logs in again) |
| `CHATWOOT_WEBHOOK_SECRET` | `.env` → recreate `api` → update the Agent Bot webhook URL in Chatwoot; the old path answers 404 until then (a 200 means Chatwoot still points at the old secret) |
| Provider API keys | Rotate at the provider → `.env` → recreate `api` → run the `GET /settings/health-llm` smoke check (Settings screen) |

### Restore from backup

Run from the repo root with the dump + uploads tarball in `$PWD`:

1. Stop the app tier: `docker compose --env-file .env -f docker/docker-compose.prod.yml stop api web proxy`
2. `… up -d postgres redis`
3. Recreate the database and load the dump:

   ```sh
   … exec -T postgres dropdb -U sa --if-exists support_agent
   … exec -T postgres createdb -U sa support_agent
   … exec -T postgres pg_restore -U sa -d support_agent --no-owner --exit-on-error < support-agent-2026-10-18.dump
   ```

4. Restore uploads (`chown` restores the app user's ownership — the API runs as `node`, uid 1000; without it the volume is left root-owned and new uploads fail):

   ```sh
   docker run --rm -v support-agent_uploads:/data -v "$PWD":/backup alpine \
     sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/support-agent-uploads-2026-10-18.tgz -C /data && chown -R 1000:1000 /data'
   ```

5. Drop stale queue state + caches (transient by design): `… exec -T redis redis-cli FLUSHALL`
6. Start everything: `… up -d` — `migrate` no-ops on the restored schema, then api/web/proxy come back.
7. Verify `/health`, log in, one playground query; note the restore timestamp for analytics expectations.

(Earlier steps abbreviate the compose invocation; it is `docker compose --env-file .env -f docker/docker-compose.prod.yml` throughout.)

## Changing the embedding model (dimension change)

Plan (not an outage-free operation, do during low traffic):

1. Pause the bot globally (kill switch).
2. Add new `embedding_v2 vector(N2)` column via migration; write a backfill script (re-embed all chunks in batches).
3. Flip `EMBEDDING_MODEL`, switch queries to the v2 column in a release.
4. Drop the old column after a week of good answers. Old cache entries are already unreachable (keys include the model id) and expire by TTL — no cache surgery needed.

## Observability & alerting

- **Logs:** pino JSON to stdout → host log driver; request id on every line; webhook id and conversation id on pipeline lines.
- **Metrics (P1):** OpenTelemetry → company Grafana; key panels: webhook rate, filter outcomes, answer latency p50/p95, LLM error rate, queue counts (`waiting/active/failed`), Redis memory, cost/day.
- **Alerts (minimal, from day one via log-based checks):** LLM error rate > 5% (5 min window), webhook 5xx > 3 in 10 min, queue `waiting` > 50 for 10 min, queue `failed` > 5 in 15 min, `/health` failing.

## Environment promotion

`dev` (local compose) → `staging` (same compose, separate Chatwoot test inbox, mock or cheap models) → `prod`. Prompts/thresholds are code + settings; promote via release, never by hand-editing prod DB for anything except the settings UI (audited).
