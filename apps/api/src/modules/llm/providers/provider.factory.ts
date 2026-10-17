import type { ConfigService } from '@nestjs/config';
import type { EmbeddingModel, LanguageModel } from 'ai';

import {
  createEchoLanguageModel,
  createFeatureHashEmbeddingModel,
  MOCK_CHAT_MODEL_ID,
  MOCK_EMBEDDING_MODEL_ID,
} from './mock.provider';

export interface LlmModels {
  embedding: EmbeddingModel;
  chat: LanguageModel;
  /** Provider-qualified ids: embedding cache namespace + `answer_events` columns. */
  embeddingModelId: string;
  chatModelId: string;
}

/** Thrown at boot when env selects a provider that is not wired yet (D2 open). */
export class LlmProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `LLM_PROVIDER="${provider}" is not wired yet — real providers land when decision D2 ` +
        '(provider & residency, docs/contributing/build-plan.md) closes. Use LLM_PROVIDER=mock locally.',
    );
    this.name = 'LlmProviderNotConfiguredError';
  }
}

/**
 * The only place that knows how to build model clients from env (ADR-0005).
 * `mock` is fully functional (deterministic, no network); `openai`,
 * `anthropic` and `self-hosted` become a switch case here once D2 closes —
 * no other module imports a provider package.
 */
export function createLlmModels(config: ConfigService): LlmModels {
  const provider = config.get<string>('LLM_PROVIDER') ?? 'mock';

  switch (provider) {
    case 'mock':
      return {
        embedding: createFeatureHashEmbeddingModel(),
        chat: createEchoLanguageModel(),
        embeddingModelId: MOCK_EMBEDDING_MODEL_ID,
        chatModelId: MOCK_CHAT_MODEL_ID,
      };
    default:
      throw new LlmProviderNotConfiguredError(provider);
  }
}
