import type { ConfigService } from '@nestjs/config';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
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

/** OpenRouter speaks the OpenAI API — the SDK equivalent is the compatible provider. */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Thrown at boot when env selects a provider that is broken or unknown. */
export class LlmProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmProviderNotConfiguredError';
  }
}

/**
 * The only place that knows how to build model clients from env (ADR-0005).
 * `mock` is fully functional (deterministic, no network). `openai` and
 * `openrouter` are the real providers (decision D2, closed 2026-10-18).
 * Embeddings always go to OpenAI (`text-embedding-3-small`, D3) — OpenRouter
 * serves chat only.
 */
export function createLlmModels(config: ConfigService): LlmModels {
  const provider = config.get<string>('LLM_PROVIDER') ?? 'mock';
  const embeddingModel = config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small';
  const chatModel = config.get<string>('CHAT_MODEL') ?? 'gpt-4.1-mini';

  switch (provider) {
    case 'mock':
      return {
        embedding: createFeatureHashEmbeddingModel(),
        chat: createEchoLanguageModel(),
        embeddingModelId: MOCK_EMBEDDING_MODEL_ID,
        chatModelId: MOCK_CHAT_MODEL_ID,
      };

    case 'openai': {
      const openai = createOpenAI({ apiKey: requireKey(config, provider, 'OPENAI_API_KEY') });
      return {
        embedding: openai.embedding(embeddingModel),
        chat: openai(chatModel),
        embeddingModelId: `openai:${embeddingModel}`,
        chatModelId: `openai:${chatModel}`,
      };
    }

    case 'openrouter': {
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey: requireKey(config, provider, 'OPENROUTER_API_KEY'),
      });
      const openai = createOpenAI({ apiKey: requireKey(config, provider, 'OPENAI_API_KEY') });
      return {
        embedding: openai.embedding(embeddingModel),
        chat: openrouter.chatModel(chatModel),
        embeddingModelId: `openai:${embeddingModel}`,
        chatModelId: `openrouter:${chatModel}`,
      };
    }

    default:
      throw new LlmProviderNotConfiguredError(
        `LLM_PROVIDER="${provider}" is not a known provider — use mock, openai, or ` +
          'openrouter (docs/integrations/llm-and-vercel-ai-sdk.md).',
      );
  }
}

/** Fail fast at boot: a missing key must not surface as a 3 AM runtime error. */
function requireKey(config: ConfigService, provider: string, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new LlmProviderNotConfiguredError(
      `LLM_PROVIDER="${provider}" needs ${key} — set it in the environment ` +
        '(docs/operations/deployment.md).',
    );
  }
  return value;
}
