import type { ConfigService } from '@nestjs/config';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { EmbeddingModel, LanguageModel } from 'ai';

import {
  createEchoLanguageModel,
  createFeatureHashEmbeddingModel,
  MOCK_CHAT_MODEL_ID,
  MOCK_EMBEDDING_MODEL_ID,
} from './mock.provider';
import { resolveChatModel } from './provider.defaults';

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
 * `mock` is fully functional (deterministic, no network). `openai`, `openrouter`,
 * `gemini` and `vertex` are the real providers (decision D2). Embeddings always
 * go to OpenAI (`text-embedding-3-small`, D3) — the others serve chat only.
 */
export function createLlmModels(config: ConfigService): LlmModels {
  const provider = config.get<string>('LLM_PROVIDER') ?? 'mock';
  const embeddingModel = config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small';
  const configuredChatModel = config.get<string>('CHAT_MODEL');

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
      const chatModel = resolveChatModel(provider, configuredChatModel);
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
      const chatModel = resolveChatModel(provider, configuredChatModel);
      return {
        embedding: openai.embedding(embeddingModel),
        chat: openrouter.chatModel(chatModel),
        embeddingModelId: `openai:${embeddingModel}`,
        chatModelId: `openrouter:${chatModel}`,
      };
    }

    case 'gemini': {
      const gemini = createGoogleGenerativeAI({
        apiKey: requireKey(config, provider, 'GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'),
      });
      const openai = createOpenAI({ apiKey: requireKey(config, provider, 'OPENAI_API_KEY') });
      const chatModel = resolveChatModel(provider, configuredChatModel);
      return {
        embedding: openai.embedding(embeddingModel),
        chat: gemini.chat(chatModel),
        embeddingModelId: `openai:${embeddingModel}`,
        chatModelId: `gemini:${chatModel}`,
      };
    }

    case 'vertex': {
      const vertex = createVertexProvider(config);
      const openai = createOpenAI({ apiKey: requireKey(config, provider, 'OPENAI_API_KEY') });
      const chatModel = resolveChatModel(provider, configuredChatModel);
      return {
        embedding: openai.embedding(embeddingModel),
        chat: vertex(chatModel),
        embeddingModelId: `openai:${embeddingModel}`,
        chatModelId: `vertex:${chatModel}`,
      };
    }

    default:
      throw new LlmProviderNotConfiguredError(
        `LLM_PROVIDER="${provider}" is not a known provider — use mock, openai, ` +
          'openrouter, gemini, or vertex (docs/integrations/llm-and-vercel-ai-sdk.md).',
      );
  }
}

/**
 * Vertex supports two auth modes: express mode with an API key, or standard
 * Google Cloud ADC with an explicit project + location. Fail at boot instead of
 * on the first customer message when neither is configured.
 */
function createVertexProvider(config: ConfigService) {
  const apiKey = config.get<string>('GOOGLE_VERTEX_API_KEY');
  if (apiKey) {
    return createGoogleVertex({ apiKey });
  }

  const project = config.get<string>('GOOGLE_VERTEX_PROJECT');
  const location = config.get<string>('GOOGLE_VERTEX_LOCATION');
  if (!project || !location) {
    throw new LlmProviderNotConfiguredError(
      'LLM_PROVIDER="vertex" needs GOOGLE_VERTEX_API_KEY (express mode) or ' +
        'GOOGLE_VERTEX_PROJECT + GOOGLE_VERTEX_LOCATION with Google Cloud ADC ' +
        '(docs/integrations/llm-and-vercel-ai-sdk.md).',
    );
  }
  return createGoogleVertex({ project, location });
}

/** Fail fast at boot: a missing key must not surface as a 3 AM runtime error. */
function requireKey(config: ConfigService, provider: string, key: string, alias?: string): string {
  const value = config.get<string>(key) ?? (alias ? config.get<string>(alias) : undefined);
  if (!value) {
    const choice = alias ? `${key} (or ${alias})` : key;
    throw new LlmProviderNotConfiguredError(
      `LLM_PROVIDER="${provider}" needs ${choice} — set it in the environment ` +
        '(docs/operations/deployment.md).',
    );
  }
  return value;
}
