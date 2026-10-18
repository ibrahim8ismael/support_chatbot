import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { createLlmModels, LlmProviderNotConfiguredError } from './provider.factory';

function config(values: Record<string, string>): ConfigService {
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

describe('createLlmModels', () => {
  it('builds the deterministic mock provider by default', () => {
    const models = createLlmModels(config({}));

    expect(models.embeddingModelId).toBe('mock-embedding-1536');
    expect(models.chatModelId).toBe('mock-chat');
  });

  it('builds OpenAI chat + embeddings with provider-qualified ids', () => {
    const models = createLlmModels(
      config({
        LLM_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        EMBEDDING_MODEL: 'text-embedding-3-small',
        CHAT_MODEL: 'gpt-4.1-mini',
      }),
    );

    expect(models.embeddingModelId).toBe('openai:text-embedding-3-small');
    expect(models.chatModelId).toBe('openai:gpt-4.1-mini');
    expect(models.embedding).toBeDefined();
    expect(models.chat).toBeDefined();
  });

  it('routes OpenRouter chat while embeddings stay with OpenAI (D3)', () => {
    const models = createLlmModels(
      config({
        LLM_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENAI_API_KEY: 'sk-test',
        CHAT_MODEL: 'openai/gpt-4.1-mini',
      }),
    );

    expect(models.chatModelId).toBe('openrouter:openai/gpt-4.1-mini');
    expect(models.embeddingModelId).toBe('openai:text-embedding-3-small');
    expect(models.chat).toBeDefined();
  });

  it('fails fast when a real provider is missing its key', () => {
    expect(() => createLlmModels(config({ LLM_PROVIDER: 'openai' }))).toThrow(
      LlmProviderNotConfiguredError,
    );
    expect(() => createLlmModels(config({ LLM_PROVIDER: 'openai' }))).toThrow(/OPENAI_API_KEY/);
  });

  it('requires both keys for openrouter (chat + embeddings)', () => {
    expect(() => createLlmModels(config({ LLM_PROVIDER: 'openrouter' }))).toThrow(
      /OPENROUTER_API_KEY/,
    );
    expect(() =>
      createLlmModels(config({ LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk-or-test' })),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('rejects unknown providers', () => {
    expect(() => createLlmModels(config({ LLM_PROVIDER: 'grok' }))).toThrow(/not a known provider/);
  });
});
