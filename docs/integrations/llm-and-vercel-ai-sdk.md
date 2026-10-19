# LLM Providers & Vercel AI SDK

All model access goes through the [Vercel AI SDK](https://ai-sdk.dev) (`ai` package + provider packages) inside the `llm` module. No other module imports a provider SDK ([ADR-0005](../decisions/0005-vercel-ai-sdk.md)). Provider HTTP transport belongs to the SDK — axios is reserved for our **own** integrations (Chatwoot API and similar), never for hand-rolled model calls.

## The two (three) roles

| Role | Setting | Used for | Example models |
| --- | --- | --- | --- |
| **Embedding model** | `EMBEDDING_MODEL` | Embedding KB chunks (ingest) + queries (retrieve) | `text-embedding-3-small` (1536 dim) — always OpenAI (D3); a self-hosted `bge-m3` (1024 dim) would re-bake the schema |
| **Chat model** | `CHAT_MODEL` | Final customer reply; classification (P1 can split) | `gpt-4.1-mini` (OpenAI) or any OpenRouter id, e.g. `openai/gpt-4.1-mini`, `anthropic/claude-…` |
| Optional small model (P1) | `CHAT_MODEL_SMALL` | Query rewrite, classification | cheapest capable model |

Hard rule: **the embedding model must be identical for ingestion and retrieval**, and its dimensions are baked into the schema ([D3](../open-decisions.md)). Changing it = re-embed everything (runbook in [deployment](../operations/deployment.md)).

## Provider configuration (env-driven)

```ts
// apps/api/src/modules/llm/providers/provider.factory.ts (as built — T-102)
case 'openai': {
  const openai = createOpenAI({ apiKey: requireKey('OPENAI_API_KEY') });
  return {
    embedding: openai.embedding(embeddingModel),   // text-embedding-3-small (D3)
    chat: openai(chatModel),                       // gpt-4.1-mini
    embeddingModelId: `openai:${embeddingModel}`,
    chatModelId: `openai:${chatModel}`,
  };
}
case 'openrouter': {
  // OpenRouter speaks the OpenAI API — chat only; embeddings stay with OpenAI.
  const openrouter = createOpenAICompatible({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: requireKey('OPENROUTER_API_KEY'),
  });
  const openai = createOpenAI({ apiKey: requireKey('OPENAI_API_KEY') });
  return {
    embedding: openai.embedding(embeddingModel),
    chat: openrouter.chatModel(chatModel),         // e.g. openai/gpt-4.1-mini
    embeddingModelId: `openai:${embeddingModel}`,
    chatModelId: `openrouter:${chatModel}`,
  };
}
```

Model ids are **provider-qualified** (`openai:…` / `openrouter:…`) so the
embedding cache namespace and `answer_events` never mix models. Missing keys or
an unknown provider fail at boot, not on the first customer message.

Why this shape: swapping model or carrier is **env config, not code**. Adding a
future provider — or going fully self-hosted if the residency policy ever
requires it — stays a new `case` in one file.

## What the module exposes

```ts
interface LlmService {
  embed(texts: string[]): Promise<number[][]>;             // embedMany under the hood
  generateReply(ctx: ReplyContext): Promise<ReplyResult>;  // generateText
  classify(ctx: ClassifyContext): Promise<Classification>; // generateObject + zod schema
}
```

`ReplyContext` carries the assembled prompt (system + knowledge + history + message) — **policy stays in the calling module** (`agent`), `llm` only executes. `ReplyResult` includes `text`, `usage` (tokens in/out), `latencyMs`, `model` id — everything analytics needs.

### Structured classification with zod

```ts
const schema = z.object({
  can_answer: z.boolean(),
  escalate_reason: z.enum(['none', 'customer_requested_human', 'out_of_scope', 'unclear']),
  intent: z.string().max(80),
});
const { object } = await generateObject({ model, schema, prompt });
```

`generateObject` gives us validated JSON from any provider that supports tool calling — no prompt-and-parse hacks.

## Where model calls happen in the pipeline

1. **Ingestion:** `embedMany(chunks)` — batches of 100, retries 3× with backoff; sha256 cache hits skip the provider entirely.
2. **Retrieval:** `embed([query])` — single vector, low latency budget (≤ 300 ms typical; cache hits ~0 ms).
3. **Classify:** one `generateObject` call (P1; MVP can fold this into the reply prompt but a structured call is cleaner and cheaper to reason about).
4. **Generate:** one `generateText` call (non-streamed — we buffer and post one complete message to Chatwoot; streaming would show partial text and Chatwoot cannot edit well).

## Call policy (applies to every call)

| Concern | Policy |
| --- | --- |
| Timeouts | 30 s hard timeout per call (AbortSignal) |
| Retries | 2 retries, exponential backoff; no retry on validation errors |
| Temperature | 0.2 for replies (friendly but consistent); 0 for classification |
| Max output | `maxReplyChars` setting (~800 chars) enforced by prompt + hard trim |
| Cost logging | tokens + model id logged to `answer_events`; cost table in code (`pricing.ts`) — update when models change |
| Caching | Identical texts hit the Redis embedding cache (key = sha256(model + text)); the provider is called once per unique text per model ([caching](../architecture/caching.md)) |
| Rate limits | worker pool of 4 caps concurrency; provider 429 → backoff respects `retry-after` |
| Secrets | API keys only from env ([security](../operations/security.md)); never logged |

## Prompt management

- Prompts live as **versioned files** next to their feature (`apps/api/src/modules/agent/prompts/answer.v2.ts`, `classify.v1.ts`) — reviewed in PRs like code, with the eval results attached for changes ([RAG pipeline § Quality](../architecture/rag-pipeline.md)).
- The system prompt is overridable via settings for fast iteration; the file is the source of truth and settings show a diff indicator (P1: DB-backed versions with rollback).
- Every `answer_events` row stores the prompt version used — so a bad answer can always be traced to an exact template.

## Data privacy

- [D2](../open-decisions.md) is **Decided (2026-10-18): (a) external APIs — OpenAI + OpenRouter.** Customer messages and retrieved KB content may reach these providers; embeddings always go to OpenAI (D3).
- Dev and CI keep `LLM_PROVIDER=mock` — nothing external is called without keys.
- Keep the payload minimal: retrieved chunks, recent turns, the customer message — no internal file names; log the provider-bound payload only at debug level and redacted (P1: PII redaction pass before provider calls). A policy reversal stays possible: a self-hosted carrier is a new factory `case`, no pipeline refactor.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Provider 5xx / timeout after retries | Return typed error → `agent` runs the escalation fallback ([message flow](../architecture/message-flow.md)) |
| `generateObject` invalid output after retries | Fail the classify step → escalate (safe default) |
| Embedding model down (ingestion) | Document marked `failed` with reason; retried via queue up to 3× |
| Embedding model down (retrieval) | Escalate, log `outcome=error`; alert if rate > 2% of answers |

## Testing

- **Unit/e2e:** use the AI SDK's mock test provider (`MockLanguageModelV2`-style) so tests never call real APIs; assert on prompt assembly, threshold decisions, escalation paths.
- **Eval runs (real models):** the `evals/` script calls the real configured models against the eval set — run manually on releases, never in CI for external providers (cost + flakiness). CI uses the mock.
- **Provider drill:** once per provider change, a smoke script runs one embed + one generate against the configured endpoint to verify connectivity, dimensions, and JSON support.
