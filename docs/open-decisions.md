# Open Decisions

Decisions that are **not made yet**. Each one blocks or shapes a part of the build. When a decision is made: update the related doc, flip the status here, and write/adjust an ADR in [`decisions/`](decisions/README.md) if it is architectural.

Status values: `Open` → `Decided` (with link to ADR/doc).

| ID | Question | Options | Recommendation | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | How do we build RAG? | (a) In-house thin pipeline on pgvector (b) LlamaIndex.TS (c) Full RAG platform (RAGFlow / AnythingLLM / Haystack) | **(a)** — fewest moving parts, we already run pgvector; wrap it behind a `Retriever` interface so we can swap later. See [ADR-0004](decisions/0004-rag-pipeline.md) | Eng | Open |
| D2 | LLM provider & data residency | (a) External APIs (OpenAI / Anthropic / Google) (b) Self-hosted open models on our infra (vLLM / Ollama / TGI) (c) Hybrid: embeddings local, chat external | Depends on policy for KB data leaving the company network. Needs a company decision, not just an engineering one | Eng + Sec | Open |
| D3 | Embedding model & vector dimensions | (a) `text-embedding-3-small` (1536 dims) (b) `bge-m3` self-hosted (1024 dims) (c) other | Pick **once per deployment** — dimensions are baked into the schema and the index. Leaning (a) if external APIs are allowed, (b) otherwise | Eng | Open |
| D4 | Dashboard auth method | (a) Local email + password (b) Company SSO (Google Workspace / Okta) | **(a)** for MVP (fast, no dependencies), add SSO later behind the same session layer | Eng | Open |
| D5 | Job queue | (a) pg-boss (Postgres-backed, no new service) (b) BullMQ (needs Redis) (c) In-process only | **Decided: (b)** — Redis enters the stack for caching anyway, so BullMQ covers the queue too. See [ADR-0006](decisions/0006-job-queue.md) | Eng | **Decided** |
| D6 | ORM | (a) Prisma + raw SQL for vector queries (b) Drizzle (typed SQL, first-class pgvector helper) | **(b)** for pgvector ergonomics, unless the team strongly prefers Prisma | Eng | Open |
| D7 | Handoff mechanism in Chatwoot | (a) Label `ai-paused` added to conversation (b) Detect human assignee (c) Both | **(c)** — listen for `conversation_updated`; label is the explicit override, assignee is the implicit one | Eng | Open |
| D8 | Non-text messages (voice notes, images, files) | (a) Always hand off to a human (b) Best-effort (transcribe/OCR) later | **(a)** for MVP; revisit when we see how often they occur | Eng | Open |
| D9 | File storage for uploads | (a) Docker volume on the host (b) MinIO / S3-compatible bucket | **(a)** for MVP; storage sits behind one module so (b) is a drop-in later | Eng | Open |
| D10 | Where Chatwoot runs relative to us | Same Docker host/network vs separate host with internal DNS | Same network at first for lowest latency; keep `CHATWOOT_BASE_URL` configurable either way | Ops | Open |

## How to close a decision

1. Assign an owner and agree on the outcome (a short Slack/meeting note is enough).
2. If architectural: write an ADR in `docs/decisions/` (copy the format of an existing one) and link it here.
3. Update the affected docs (`architecture/*`, `integrations/*`, etc.).
4. Set status to `Decided`.
