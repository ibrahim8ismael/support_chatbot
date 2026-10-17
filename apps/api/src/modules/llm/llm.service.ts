import { Injectable } from '@nestjs/common';

/**
 * LLM — model/provider access only (Vercel AI SDK, ADR-0005).
 * Exposes to other modules: embed(texts), generateReply(ctx), classify(ctx);
 * model/provider configuration.
 * Does NOT do: any prompt *policy* — prompt templates live with the calling
 * modules (`agent`, `retrieval`) as versioned files (repo-structure.md note).
 *
 * TODO(llm): provider wiring for LLM_PROVIDER openai|anthropic|self-hosted, plus
 * a deterministic fake provider for `mock` (docs/contributing/development.md).
 */
@Injectable()
export class LlmService {}
