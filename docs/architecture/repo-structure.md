# Repo Structure (Modular Monolith)

One repository, one API deployable, one dashboard deployable. Clear module boundaries inside — see [ADR-0001](../decisions/0001-modular-monolith.md).

```
support-chatbot/
├── apps/
│   ├── api/                     # NestJS — the modular monolith backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts    # wires all modules together
│   │   │   └── modules/         # ← see module table below
│   │   ├── test/                # e2e tests (webhook simulator etc.)
│   │   └── Dockerfile
│   ├── web/                     # Next.js dashboard
│   │   ├── app/                 # routes: (auth)/login, (dashboard)/knowledge-bases, ...
│   │   ├── components/
│   │   ├── lib/                 # API client, hooks
│   │   └── Dockerfile
│   └── (worker split later; jobs run inside api for now — ADR-0006)
├── packages/
│   ├── shared/                  # types, zod schemas, constants shared by api & web
│   └── config/                  # eslint / tsconfig / prettier presets
├── docs/                        # ← you are here
├── docker/
│   ├── docker-compose.yml       # dev
│   └── docker-compose.prod.yml  # prod
├── package.json                 # workspace root scripts
├── pnpm-workspace.yaml
└── turbo.json
```

## API modules

Each module owns its controllers, services, and database access. Cross-module calls happen through the owning module's **public service API**, never by importing another module's repository/entities.

| Module | Owns (tables) | Exposes to other modules | Doesn't do |
| --- | --- | --- | --- |
| `auth` | `users`, `sessions` | `AuthGuard`, `CurrentUser`, `RolesGuard` | Business logic of other domains |
| `users` | (uses `users`) | user CRUD, role management (admin) | Login/session handling |
| `knowledge-base` | `knowledge_bases`, `documents` | KB/document CRUD, upload/file lifecycle (`UPLOAD_DIR`) | Parsing/chunking/embedding; Chatwoot |
| `ingestion` | `chunks` (write) | `enqueueIngestion(documentId)`; job handlers | Retrieval |
| `retrieval` | `chunks` (read) | `retrieve(query, kbIds, opts) → chunks + scores + trace` | Talking to models directly (uses `llm`); event writes — the agent folds the trace into `answer_events` |
| `llm` | — | `embed(texts)`, `generateReply(ctx)`, `classify(ctx)`; model/provider config | Any prompt *policy* — prompts/templates live in the calling modules (see note) |
| `conversations` | `conversations`, `messages` | conversation/message upsert & lookup; per-conversation lock | Chatwoot HTTP details |
| `chatwoot` | — (stores channel ids on conversations) | `verifyWebhook()`, `sendMessage()`, `addPrivateNote()`, `addLabel()`; shared axios client | Deciding *what* to reply |
| `agent` (orchestrator) | — | `ask()` answer core (query build → retrieval → prompt → guard) + playground `POST /playground/ask`; `handleIncomingMessage()` gluing chatwoot → retrieval → llm → chatwoot lands with the live pipeline (T-203) | Anything reused; it is the composition point |
| `bindings` | `inbox_bindings` | inbox ↔ KB mapping, `getBoundKbIdsForInbox()` | KB CRUD itself |
| `analytics` | `answer_events`, `audit_logs` | aggregation queries for dashboard | Writing events (modules write via its service) |
| `settings` | `settings` | typed get/set of runtime settings | Secrets (those are env-only) |
| `infra` | — (Redis) | BullMQ `QueueService`, Redis `CacheService`, worker registration, per-conversation locks | Domain logic; job business logic (lives in the owning modules) |
| `health` | — | `/health` | — |

> Note on prompts: prompt **templates** live with the feature that uses them (`agent`, `retrieval`) as versioned files; the `llm` module only executes model calls. This keeps the provider layer dumb and the policies reviewable.

## Module boundary rules

**Do**

- Call other modules via their exported service (injected via Nest DI).
- Emit/consume async work through the job queue for side effects (e.g., `analytics` subscribes to answer events).
- Keep DTOs at the edge (controllers) validated with zod schemas from `packages/shared` when the shape is shared with the web app.

**Don't**

- Import another module's entity/repository or query its tables directly.
- Call model providers outside `llm`.
- Call the Chatwoot API outside `chatwoot`.
- Add a new module without a row in the table above.

## Conventions

- **Naming:** modules singular (`chatwoot`, not `chatwoots`); services `<Thing>Service`; jobs `<Thing>JobHandler`.
- **Files:** `foo.controller.ts`, `foo.service.ts`, `foo.module.ts`, `dto/`, `entities/`.
- **Migrations:** `apps/api/src/db/migrations` — every schema change is a migration (never hand-edit the DB).
- **Tests live next to code** (`foo.service.spec.ts`) except e2e in `apps/api/test`.
- **Zod at boundaries:** webhook payloads, controller bodies, env — parse, don't trust.
- **Package manager:** pnpm only (corepack-enforced `packageManager` field); shared code lives in `packages/*`, never copy-pasted between apps.
- **HTTP:** one axios instance per integration, created in the owning module (e.g. `chatwoot/http.client.ts`), with timeout and logging interceptors. Model provider calls bypass axios entirely (AI SDK only).

## Future split path

If ingestion (CPU-heavy parsing/embedding) or webhook pressure ever outgrows one process:

1. Extract `apps/worker` that imports the same NestJS modules and runs only job handlers.
2. Keep the same Postgres + Redis; BullMQ already gives at-least-once semantics (attempts + backoff).

Nothing in the module map changes — only how modules are hosted.
