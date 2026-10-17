# ADR-0005 — Vercel AI SDK as the Model Access Layer

- Status: Accepted
- Date: 2026-10-17

## Context

We call two kinds of models: an **embedding model** (KB chunks + queries) and a **chat model** (customer replies, classification). Providers are not final ([D2](../open-decisions.md) is open; self-hosted is a real possibility for data-residency reasons). We want: one programming model, provider swap by config, structured outputs (zod), and no lock-in to any provider SDK. Options: raw provider SDKs (lock-in, N× code), LangChain (heavy abstraction, cache of features we don't need), Vercel AI SDK (`ai` package; TS-first, typed, provider packages incl. OpenAI-compatible for self-hosted).

## Decision

- All model calls go through the **Vercel AI SDK** inside the `llm` module: `embedMany`/`embed` for vectors, `generateText` for replies, `generateObject` + zod for classification.
- Providers are created from env (`LLM_PROVIDER`, model ids) — including `createOpenAICompatible` for vLLM/Ollama/TGI self-hosted endpoints.
- No other module imports a provider package; `llm` exposes intention-named methods (`embed`, `generateReply`, `classify`) and returns usage/latency metadata for analytics.
- Non-streamed generation (Chatwoot gets one complete message).

## Consequences

- **Easy:** provider swap is config; self-hosted vs external is the same code path; structured output and token accounting come for free; tests run against the SDK's mock provider.
- **Hard (accepted):** SDK upgrade schedule is us following their releases; prompt "policy" deliberately stays out of the SDK (we do not use their prompt tooling) so a future swap of even the SDK itself is contained to one module.
- **Watch:** if a required capability lands provider-specific (e.g., a special embedding API), wrap it as an alternate implementation inside `llm` — never leak it to callers.
