import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { EMBEDDING_DIMENSIONS } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import { RuntimeMetricsService } from '../../common/metrics/runtime-metrics.service';
import type { CacheService } from '../infra/cache.service';
import { decodeEmbedding, embeddingCacheKey, encodeEmbedding, LlmService } from './llm.service';
import { LlmProviderNotConfiguredError } from './providers/provider.factory';

function buildHarness(provider = 'mock', options: { cacheWrites?: number } = {}) {
  const config = {
    get: vi.fn((key: string) => (key === 'LLM_PROVIDER' ? provider : undefined)),
  } as unknown as ConfigService;

  const store = new Map<string, unknown>();
  let writes = options.cacheWrites ?? 0;
  const cache = {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    incrByWithTtl: vi.fn(async (_key: string, amount: number) => {
      writes += amount;
      return writes;
    }),
  } as unknown as CacheService;

  const logger = { debug: vi.fn(), warn: vi.fn() } as unknown as AppLogger;
  const metrics = new RuntimeMetricsService();

  return {
    service: new LlmService(config, cache, logger, metrics),
    cache,
    store,
    metrics,
    logger,
  };
}

/** Cached vectors come back as float32 — compare with precision tolerance. */
function expectVectorsClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index] ?? Number.NaN, 5);
  });
}

/** `embeddings[i]` under noUncheckedIndexedAccess — `[]` fails the length check. */
function vectorAt(embeddings: number[][], index: number): number[] {
  const vector = embeddings[index];
  expect(vector).toBeDefined();
  return vector ?? [];
}

describe('LlmService', () => {
  it('exposes the provider-qualified model ids', () => {
    const { service } = buildHarness();
    expect(service.modelIds).toEqual({
      embedding: 'mock-embedding-1536',
      chat: 'mock-chat',
    });
  });

  describe('embed', () => {
    it('embeds at the locked dimensions and caches every fresh vector', async () => {
      const { service, cache, store } = buildHarness();

      const result = await service.embed(['reset my password']);

      expect(result.model).toBe('mock-embedding-1536');
      expect(result.dimensions).toBe(EMBEDDING_DIMENSIONS);
      expect(result.embeddings).toHaveLength(1);
      expect(result.embeddings[0]).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(result.cacheHits).toBe(0);
      expect(result.tokens).toBe(3);
      expect(store.size).toBe(1);
      expect(cache.set).toHaveBeenCalledWith(
        embeddingCacheKey('mock-embedding-1536', 'reset my password'),
        encodeEmbedding(vectorAt(result.embeddings, 0)),
        24 * 60 * 60,
      );
    });

    it('serves a repeated text from the embedding cache without provider tokens', async () => {
      const { service, cache } = buildHarness();

      const first = await service.embed(['reset my password']);
      const second = await service.embed(['reset my password']);

      expectVectorsClose(vectorAt(second.embeddings, 0), vectorAt(first.embeddings, 0));
      expect(second.cacheHits).toBe(1);
      expect(second.tokens).toBe(0);
      // Two gets, one set: the second call never wrote a new vector.
      expect(cache.set).toHaveBeenCalledTimes(1);
    });

    it('embeds duplicate inputs once and keeps response order', async () => {
      const { service } = buildHarness();

      const result = await service.embed(['hello world', 'hello world']);

      expect(result.embeddings[0]).toEqual(result.embeddings[1]);
      expect(result.tokens).toBe(2);
      expect(result.cacheHits).toBe(1);
    });

    it('preserves input order when vectors are cached', async () => {
      const { service } = buildHarness();

      const first = await service.embed(['alpha', 'beta']);
      const second = await service.embed(['beta', 'alpha']);

      expect(second.cacheHits).toBe(2);
      expect(second.tokens).toBe(0);
      expectVectorsClose(vectorAt(second.embeddings, 0), vectorAt(first.embeddings, 1));
      expectVectorsClose(vectorAt(second.embeddings, 1), vectorAt(first.embeddings, 0));
    });

    it('handles an empty batch without calling the provider', async () => {
      const { service, cache } = buildHarness();

      const result = await service.embed([]);

      expect(result.embeddings).toEqual([]);
      expect(result.tokens).toBe(0);
      expect(result.cacheHits).toBe(0);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('serves fresh vectors uncached once the hourly write budget is spent', async () => {
      const { service, cache, logger } = buildHarness('mock', { cacheWrites: 200 });

      const result = await service.embed(['a brand new text']);

      expect(result.embeddings[0]).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(cache.set).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('round-trips vectors through the base64 float32 codec', () => {
      const vector = [0.5, -1.25, 3];

      expect(decodeEmbedding(encodeEmbedding(vector))).toEqual(vector);
      // Anything that is not a base64 float32 payload is a miss, never garbage.
      expect(decodeEmbedding('not a vector')).toBeNull();
      expect(decodeEmbedding([1, 2, 3])).toBeNull();
      expect(decodeEmbedding(undefined)).toBeNull();
    });
  });

  describe('generateReply', () => {
    it('returns the mock echo with usage and model metadata', async () => {
      const { service } = buildHarness();

      const result = await service.generateReply({
        system: 'be helpful',
        messages: [
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'where is my order?' },
        ],
      });

      expect(result.text).toBe('I received: where is my order?');
      expect(result.model).toBe('mock-chat');
      expect(result.finishReason).toBe('stop');
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('classify', () => {
    const classificationSchema = z.object({
      can_answer: z.boolean(),
      escalate_reason: z.string().nullable(),
      intent: z.enum(['question', 'other']),
    });

    it('returns a schema-validated object from generateObject', async () => {
      const { service } = buildHarness();

      const result = await service.classify({
        system: 'classify the customer message',
        messages: [{ role: 'user', content: 'where is my order?' }],
        schema: classificationSchema,
      });

      expect(result.object).toEqual({
        can_answer: true,
        escalate_reason: null,
        intent: 'question',
      });
      expect(result.model).toBe('mock-chat');
      expect(result.usage.inputTokens).toBeGreaterThan(0);
    });
  });

  it('fails fast at boot for misconfigured providers', () => {
    // Real providers are wired (D2 closed), but this harness carries no keys.
    expect(() => buildHarness('openai')).toThrow(LlmProviderNotConfiguredError);
    expect(() => buildHarness('openai')).toThrow(/OPENAI_API_KEY/);
    expect(() => buildHarness('grok')).toThrow(/not a known provider/);
  });
});
