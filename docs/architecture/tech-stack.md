# Tech Stack

Every choice below links to a decision record when one exists. Version numbers are "minimum / current at design time" — pin exact versions in `package.json` and Dockerfiles, don't trust a doc.

## Summary

| Layer | Choice | Why | Alternatives considered |
| --- | --- | --- | --- |
| Language | TypeScript (strict) everywhere | One language across api/web/shared; AI SDK is TS-first | Python for RAG (rejected: second language, no need yet) |
| Dashboard | **Next.js** (App Router) | Team knows React; SSR for protected pages; simple Docker deploy as Node server | Remix, plain Vite SPA (weaker server story) |
| Dashboard UI | **HeroUI v3** + Tailwind CSS v4 | Accessible React Aria components (Table, Dialog, Select…), theme tokens + dark mode, fast composition from ready blocks | shadcn/ui (copy-in Radix), MUI (heavy), plain CSS modules |
| API | **NestJS** | DI + modules map 1:1 to our modular monolith; first-class validation, guards, testing | Fastify raw (more boilerplate), Express (too loose), tRPC-only (no webhooks story) |
| Database | **Postgres 16+** | Relational data + vectors in one place ([ADR-0002](../decisions/0002-postgres-pgvector.md)) | Separate vector DB (Qdrant etc. — extra ops), Mongo (no vectors story) |
| Vectors | **pgvector** (HNSW, cosine) | Same DB, good enough to millions of vectors | Pinecone/Qdrant/Weaviate |
| Queue | **BullMQ on Redis** ([ADR-0006](../decisions/0006-job-queue.md)) | Durable retries, backoff, scheduling, job events; Redis is in the stack for caching anyway | pg-boss (no new service), in-process timers |
| Cache | **Redis** | Embedding + retrieval + settings caching, rate-limit counters — see [caching](caching.md) | In-process LRU (per-instance, lost on restart), no cache |
| RAG | **In-house thin pipeline** on pgvector (proposed, [ADR-0004](../decisions/0004-rag-pipeline.md)) | Fewest moving parts; we control chunking/prompts/evals | LlamaIndex.TS, RAGFlow/AnythingLLM (extra service) |
| Model access | **Vercel AI SDK** (`ai` + provider packages) | One interface for embeddings, text, structured output; swap providers incl. self-hosted via OpenAI-compatible ([ADR-0005](../decisions/0005-vercel-ai-sdk.md)) | Raw provider SDKs (lock-in), LangChain (heavy) |
| Outbound HTTP | **axios** | One instance per integration with timeout/retry/logging interceptors (Chatwoot API first); model calls stay inside the AI SDK | native fetch, got, undici |
| Embedding model | `text-embedding-3-small` (1536 dims) — OpenAI (D3, closed) | Dimensions are baked into the schema; changing it = re-embed everything | — |
| Chat model | `gpt-4.1-mini` via OpenAI, any OpenRouter id, or a Gemini model via Gemini or Vertex AI (D2, closed) | External APIs approved: OpenAI + OpenRouter + Gemini + Vertex AI (chat) | — |
| Parsing | `pdfjs`/`pdf-parse` (PDF), `mammoth` (DOCX), plain text/MD readers | Mature, no service needed | Unstructured.io (service), cloud parsers |
| Auth | Session cookie + argon2 (proposed, D4) | Internal app; simple and safe | NextAuth (dashboard-only, splits auth), SSO later |
| ORM | Drizzle preferred (proposed, D6) | Typed SQL + built-in pgvector helpers (`cosineDistance`) | Prisma (great DX, weaker vector story), TypeORM |
| Validation | Zod (shared schemas in `packages/shared`) | One schema shared by web + api for shared types | class-validator only (can't share with web) |
| Monorepo | **pnpm** workspaces + Turborepo | Fast, cached builds; strict dependency resolution; enforced via `packageManager` + corepack | npm/yarn workspaces, Nx (powerful, heavier) |
| Packaging | Docker + Docker Compose | Existing company standard; single host | Kubernetes (overkill for internal scale) |
| Reverse proxy | Caddy (or company's existing proxy) | Automatic TLS, ~5 lines of config | nginx (fine, more config) |
| Logging | pino (JSON) + request ids | Structured, greppable; standard NestJS option | Winston (comparable) |
| LLM tracing (P1) | Langfuse self-hosted (optional) | Full prompt/response traces for evals & debugging | OTel-only traces (less LLM-aware) |

## Runtime versions

| Thing | Version |
| --- | --- |
| Node.js | 22 LTS or newer (whatever is current LTS in the company base image) |
| pnpm | 9+ |
| Postgres image | `pgvector/pgvector:pg16` (includes extension; pin a digest in prod) |
| Redis | 7+ (`redis:7-alpine` image; AOF on in prod) |
| Next.js | current stable (App Router) |
| NestJS | 10+ |

## What we are deliberately NOT using

- **A second cache/queue technology** (Memcached, RabbitMQ, a separate vector search service) — Redis covers queue + cache in one small service; more infra is added only when a measured need demands it.
- **A dedicated vector DB** — pgvector is within our scale envelope; the retriever interface lets us revisit.
- **A heavyweight RAG framework** — pending D1/ADR-0004; LlamaIndex.TS stays an option if we outgrow the thin pipeline.
- **Kubernetes / service mesh** — an internal tool on one host does not need it.
- **LangChain** — the Vercel AI SDK plus our own small pipeline is leaner and we keep full control of prompts.
- **npm / yarn** — pnpm only: one lockfile format, strict dependency resolution, corepack enforcement.

## Open stack questions

- D1 RAG approach, D2 model provider & residency, D3 embedding model, D4 auth, D6 ORM, D8 non-text handling, D9 file storage — all tracked in [open-decisions.md](../open-decisions.md).
