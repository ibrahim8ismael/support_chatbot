# ADR-0004 — RAG: In-House Thin Pipeline vs Framework/Platform

- Status: **Proposed** (decision tracked as [D1](../open-decisions.md))
- Date: 2026-10-17

## Context

We need classic RAG: parse → chunk → embed → vector search → prompt assembly → grounded answer with citations for analytics. Options:

| Option | What it gives | What it costs |
| --- | --- | --- |
| (a) **In-house thin pipeline** on pgvector | Full control of chunking/prompts/evals; zero new services; small code surface (~few hundred lines) | We build and own the quality work; advanced features (rerank, hybrid) are ours to add |
| (b) **LlamaIndex.TS** | Ready-made ingestion/retrieval nodes, loaders | Another abstraction on top of our stack; version churn; we still tune everything ourselves |
| (c) **RAG platform** (RAGFlow / AnythingLLM / Haystack service) | Out-of-the-box parsing+UI+pipeline | A whole extra service + store + auth surface to run; fights our dashboard for ownership of KBs |

Our scale (KBs ≤ ~50k chunks, formats: PDF/DOCX/TXT/MD) and needs (tight analytics integration, strict grounding rules, eval-driven tuning) are squarely in "simple pipeline, well-tuned" territory, not "complex framework needed".

## Decision (proposed)

Go with **(a) in-house thin pipeline**, structured so (b) stays a swap-in option:

- One `Retriever` interface; pgvector implementation behind it.
- Ingestion is a plain job pipeline with parse/chunk/embed steps in separate functions — each unit-testable.
- Revisit if we need graph RAG, multi-source connectors, or managed parsing at a scale/quality our own pipeline can't reach; ADR supersedes.

## Consequences

- **Easy:** no new runtime dependencies or services; prompts, thresholds, metadata, and evals stay in our repo where the analytics live.
- **Hard (accepted):** we own parser edge cases (scanned PDFs, tables) — mitigation: start with clean sources, surface per-document errors, paste/URL fallback.
- **Reversible:** interface `Retriever` + modular ingestion mean adopting a framework later happens behind existing seams, without touching the agent or dashboard.
