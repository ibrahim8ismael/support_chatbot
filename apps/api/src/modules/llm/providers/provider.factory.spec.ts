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

  it('uses provider-specific default chat models when CHAT_MODEL is unset', () => {
    const openai = createLlmModels(config({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }));
    const openrouter = createLlmModels(
      config({
        LLM_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENAI_API_KEY: 'sk-test',
      }),
    );
    const gemini = createLlmModels(
      config({
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gemini-test',
        OPENAI_API_KEY: 'sk-test',
      }),
    );
    const vertex = createLlmModels(
      config({
        LLM_PROVIDER: 'vertex',
        GOOGLE_VERTEX_API_KEY: 'vertex-test',
        OPENAI_API_KEY: 'sk-test',
      }),
    );

    expect(openai.chatModelId).toBe('openai:gpt-4.1-mini');
    expect(openrouter.chatModelId).toBe('openrouter:openai/gpt-4.1-mini');
    expect(gemini.chatModelId).toBe('gemini:gemini-3.8-flash');
    expect(vertex.chatModelId).toBe('vertex:gemini-3.8-flash');
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

  it('routes Gemini chat while embeddings stay with OpenAI (D3)', () => {
    const models = createLlmModels(
      config({
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gemini-test',
        OPENAI_API_KEY: 'sk-test',
        CHAT_MODEL: 'gemini-3.6-flash',
      }),
    );

    expect(models.chatModelId).toBe('gemini:gemini-3.6-flash');
    expect(models.embeddingModelId).toBe('openai:text-embedding-3-small');
    expect(models.chat).toBeDefined();
    expect(models.embedding).toBeDefined();
  });

  it('accepts the Google SDK key alias for Gemini', () => {
    const models = createLlmModels(
      config({
        LLM_PROVIDER: 'gemini',
        GOOGLE_GENERATIVE_AI_API_KEY: 'google-test',
        OPENAI_API_KEY: 'sk-test',
      }),
    );

    expect(models.chatModelId).toBe('gemini:gemini-3.8-flash');
  });

  it('routes Vertex chat (express mode) while embeddings stay with OpenAI (D3)', () => {
    const models = createLlmModels(
      config({
        LLM_PROVIDER: 'vertex',
        GOOGLE_VERTEX_API_KEY: 'vertex-test',
        OPENAI_API_KEY: 'sk-test',
        CHAT_MODEL: 'gemini-3.6-flash',
      }),
    );

    expect(models.chatModelId).toBe('vertex:gemini-3.6-flash');
    expect(models.embeddingModelId).toBe('openai:text-embedding-3-small');
    expect(models.chat).toBeDefined();
    expect(models.embedding).toBeDefined();
  });

  it('routes Vertex chat in ADC mode with a project and location', () => {
    const models = createLlmModels(
      config({
        LLM_PROVIDER: 'vertex',
        GOOGLE_VERTEX_PROJECT: 'my-project',
        GOOGLE_VERTEX_LOCATION: 'us-central1',
        OPENAI_API_KEY: 'sk-test',
      }),
    );

    expect(models.chatModelId).toBe('vertex:gemini-3.8-flash');
    expect(models.embeddingModelId).toBe('openai:text-embedding-3-small');
  });

  it('fails fast when Vertex has neither an API key nor project + location', () => {
    expect(() =>
      createLlmModels(config({ LLM_PROVIDER: 'vertex', OPENAI_API_KEY: 'sk-test' })),
    ).toThrow(/GOOGLE_VERTEX_API_KEY/);
    expect(() =>
      createLlmModels(
        config({
          LLM_PROVIDER: 'vertex',
          GOOGLE_VERTEX_PROJECT: 'my-project',
          OPENAI_API_KEY: 'sk-test',
        }),
      ),
    ).toThrow(/GOOGLE_VERTEX_LOCATION/);
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

  it('requires both keys for gemini (chat + embeddings)', () => {
    expect(() => createLlmModels(config({ LLM_PROVIDER: 'gemini' }))).toThrow(/GEMINI_API_KEY/);
    expect(() =>
      createLlmModels(config({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'gemini-test' })),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('requires OpenAI embeddings even when Vertex chat is configured', () => {
    expect(() =>
      createLlmModels(config({ LLM_PROVIDER: 'vertex', GOOGLE_VERTEX_API_KEY: 'vertex-test' })),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('rejects unknown providers', () => {
    expect(() => createLlmModels(config({ LLM_PROVIDER: 'grok' }))).toThrow(/not a known provider/);
  });
});
