# Glossary

Terms used across the project docs. When a term below appears in a doc, it means this.

| Term | Meaning |
| --- | --- |
| **Agent Bot** | Chatwoot's mechanism for connecting a bot to inboxes. Chatwoot sends webhooks to our system and we reply with the bot token via the Chatwoot API. |
| **Assignee** | The human agent currently responsible for a Chatwoot conversation. If set, the bot stays out unless explicitly re-enabled. |
| **BullMQ** | The job queue library we run on Redis: retries, backoff, scheduling, and the per-conversation processing lock ([ADR-0006](decisions/0006-job-queue.md)). |
| **Chunk** | A small, self-contained slice of a document (a few hundred tokens) that is embedded and stored in pgvector. Retrieval returns chunks, not whole documents. |
| **Conversation** | A Chatwoot thread between one contact and the account. All messages we answer belong to a conversation. |
| **Deflection** | A customer question fully handled by the bot without human involvement. Our main success metric. |
| **Document** | An uploaded file (PDF, DOCX, TXT, MD) that belongs to a knowledge base and gets ingested into chunks. |
| **Embedding** | A numeric vector that represents the meaning of a text. Produced by the embedding model; stored in Postgres with pgvector. |
| **Embedding cache** | Redis cache of text → vector (key = `sha256(model + text)`). Identical questions never re-call the embedding provider. |
| **Escalation / Handoff** | Turning a conversation over to a human agent. The bot posts a private note summary and stops replying. |
| **HNSW** | Hierarchical Navigable Small World — the pgvector index type we use for fast approximate nearest-neighbor search. |
| **Inbox** | A Chatwoot inbox tied to one channel (e.g., "WhatsApp Support", "Website Widget"). Bot bindings are configured per inbox. |
| **KB / Knowledge Base** | A named collection of documents served together for retrieval (e.g., "Billing FAQ", "Product Manual"). |
| **LlmModule** | Our NestJS module that wraps the Vercel AI SDK. The only place in the codebase that talks to model providers. |
| **Message** | One item in a conversation. Chatwoot message types we care about: `incoming` (from customer), `outgoing` (human or bot), `template`. |
| **pgvector** | PostgreSQL extension adding the `vector` column type and vector search operators/indexes. |
| **Private note** | A Chatwoot message visible only to agents (not the customer). We use these for handoff summaries. |
| **Prompt injection** | A malicious/accidental instruction embedded in customer text or KB content (e.g., "ignore your instructions"). A key risk we mitigate. |
| **RAG** | Retrieval-Augmented Generation — retrieve relevant chunks, then let the chat model write an answer grounded in them. |
| **Reranking** | A second-pass scoring of retrieved chunks (usually with a small model cross-encoder) to improve ordering. Post-MVP. |
| **Redis** | In-memory store used for the BullMQ queue and caches. Ephemeral by design — everything durable is in Postgres. |
| **Retrieval cache** | Redis cache of chunk ids + scores for a given (KB set, query) pair; TTL 15 min, auto-invalidated by KB version bumps. |
| **Retrieval event** | A logged record of one search: query, returned chunks, scores, latency. Powers analytics and debugging. |
| **Token** | The unit models bill and limit by. Roughly ¾ of an English word. |
| **Top-k** | How many chunks retrieval returns as candidates (before filtering/reranking). Default: 10. |
| **Vector / Vector search** | Finding rows by similarity of their embedding to a query embedding. We use cosine distance (`<=>` operator). |
| **Vercel AI SDK** | The `ai` npm package (+ provider packages) we use for all model calls: embeddings, generation, structured output. |
