import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { embedMany, generateText, Output } from 'ai';
import type { z } from 'zod';

import { EMBEDDING_DIMENSIONS } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { RuntimeMetricsService } from '../../common/metrics/runtime-metrics.service';
import { CacheService } from '../infra/cache.service';
import type {
  ClassifyInput,
  ClassifyResult,
  EmbedResult,
  GenerateReplyInput,
  GenerateReplyResult,
} from './llm.types';
import { createLlmModels, type LlmModels } from './providers/provider.factory';

/** Provider calls must never hang a request or worker (audit HIGH). */
const CHAT_TIMEOUT_MS = 60_000;
const EMBEDDING_TIMEOUT_MS = 120_000;

/**
 * docs/architecture/caching.md: embedding cache TTL + write budget. Vectors are
 * stored as base64 float32 (~8 KB for 1536 dims instead of ~30 KB of JSON) with
 * a short TTL and an hourly write budget — the shared Redis is small and
 * `noeviction`, so the cache must stay bounded in size *and* count (audit HIGH).
 */
const EMBEDDING_CACHE_TTL_SECONDS = 24 * 60 * 60;
const EMBEDDING_CACHE_WRITES_PER_HOUR = 200;

/** `emb:v2:{model}:sha256(text)` — caching.md; model or format change misses. */
export function embeddingCacheKey(modelId: string, text: string): string {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  return `emb:v2:${modelId}:${hash}`;
}

/** float32 base64 — provider output precision, small footprint. */
export function encodeEmbedding(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString('base64');
}

/** `null` for anything that is not a base64 float32 vector (treated as a miss). */
export function decodeEmbedding(value: unknown): number[] | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  try {
    const buffer = Buffer.from(value, 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) {
      return null;
    }
    const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
    return Array.from(floats);
  } catch {
    return null;
  }
}

/**
 * LLM — model/provider access only (Vercel AI SDK, ADR-0005).
 * Exposes to other modules: embed(texts), generateReply(ctx), classify(ctx);
 * model/provider configuration.
 * Does NOT do: any prompt *policy* — prompt templates live with the calling
 * modules (`agent`, `retrieval`) as versioned files (repo-structure.md note).
 *
 * Embeddings are cached in Redis (NFR-9): key per text, so ingestion and
 * retrieval share vectors and a model change lands in a fresh namespace.
 */
@Injectable()
export class LlmService {
  private readonly models: LlmModels;

  constructor(
    config: ConfigService,
    private readonly cache: CacheService,
    private readonly logger: AppLogger,
    private readonly metrics: RuntimeMetricsService,
  ) {
    // Fails fast at boot on a broken provider config (missing key / unknown provider).
    this.models = createLlmModels(config);
  }

  /**
   * Every provider call goes through here: the T-404 alert check reads the
   * success/error counters (process-local) to alert on the LLM error rate, and
   * the abort signal guarantees the call cannot hang forever.
   * Cache-only work never touches this.
   */
  private async providerCall<T>(
    timeoutMs: number,
    call: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    try {
      const result = await call(AbortSignal.timeout(timeoutMs));
      this.metrics.recordLlmCall(true);
      return result;
    } catch (error) {
      this.metrics.recordLlmCall(false);
      throw error;
    }
  }

  /** Model ids for analytics (`answer_events.model` etc.). */
  get modelIds(): { embedding: string; chat: string } {
    return { embedding: this.models.embeddingModelId, chat: this.models.chatModelId };
  }

  /**
   * Embed texts in one batch, reusing cached vectors. Order is preserved;
   * duplicate inputs are embedded once. Cache misses are embedded in a single
   * provider call (NFR-9).
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    const started = Date.now();
    const keys = texts.map((text) => embeddingCacheKey(this.models.embeddingModelId, text));
    const textByKey = new Map<string, string>();
    keys.forEach((key, index) => {
      textByKey.set(key, texts[index] ?? '');
    });

    const byKey = new Map<string, number[]>();
    const cached = await Promise.all(keys.map((key) => this.cache.get<unknown>(key)));
    cached.forEach((raw, index) => {
      const key = keys[index];
      const vector = decodeEmbedding(raw);
      if (vector && key) {
        byKey.set(key, vector);
      }
    });

    const misses = [...textByKey.keys()].filter((key) => !byKey.has(key));
    let tokens = 0;

    if (misses.length > 0) {
      const result = await this.providerCall(EMBEDDING_TIMEOUT_MS, (signal) =>
        embedMany({
          model: this.models.embedding,
          values: misses.map((key) => textByKey.get(key) ?? ''),
          abortSignal: signal,
        }),
      );
      tokens = result.usage.tokens;

      // Bounded writes: at most EMBEDDING_CACHE_WRITES_PER_HOUR fresh vectors
      // per hour; overflow is still answered, just not cached.
      const hourBucket = new Date().toISOString().slice(0, 13);
      const writes = await this.cache.incrByWithTtl(
        `emb:writes:${hourBucket}`,
        misses.length,
        3600,
      );
      const cacheable = writes === null || writes <= EMBEDDING_CACHE_WRITES_PER_HOUR;
      if (!cacheable) {
        this.logger.warn(
          `embedding cache write budget reached (${writes}/${EMBEDDING_CACHE_WRITES_PER_HOUR} this hour) — serving fresh vectors uncached`,
          LlmService.name,
        );
      }

      await Promise.all(
        misses.map(async (key, index) => {
          const embedding = result.embeddings[index];
          if (!embedding) {
            throw new Error(
              `embedding provider returned ${result.embeddings.length} vectors for ${misses.length} inputs`,
            );
          }
          if (embedding.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(
              `embedding model "${this.models.embeddingModelId}" returned ${embedding.length} dimensions, ` +
                `expected ${EMBEDDING_DIMENSIONS} (D3 / chunks.embedding vector(${EMBEDDING_DIMENSIONS}))`,
            );
          }
          byKey.set(key, embedding);
          if (cacheable) {
            await this.cache.set(key, encodeEmbedding(embedding), EMBEDDING_CACHE_TTL_SECONDS);
          }
        }),
      );
    }

    const embeddings = keys.map((key) => {
      const vector = byKey.get(key);
      if (!vector) {
        throw new Error(`embedding missing for cache key ${key}`);
      }
      return vector;
    });

    const result: EmbedResult = {
      embeddings,
      model: this.models.embeddingModelId,
      dimensions: EMBEDDING_DIMENSIONS,
      tokens,
      cacheHits: keys.length - misses.length,
      latencyMs: Date.now() - started,
    };

    this.logger.debug(
      `embed: ${keys.length} input(s), ${misses.length} fresh, ${tokens} token(s)`,
      LlmService.name,
    );
    return result;
  }

  /** Non-streamed reply generation (ADR-0005); the caller owns the prompt. */
  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
    const started = Date.now();
    const result = await this.providerCall(CHAT_TIMEOUT_MS, (signal) =>
      generateText({
        model: this.models.chat,
        system: input.system,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        maxOutputTokens: input.maxOutputTokens,
        temperature: input.temperature,
        abortSignal: signal,
      }),
    );

    return {
      text: result.text,
      model: this.models.chatModelId,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
      finishReason: result.finishReason,
      latencyMs: Date.now() - started,
    };
  }

  /** Structured output (zod schema) for classification/eval decisions. */
  async classify<TSchema extends z.ZodType>(
    input: ClassifyInput<TSchema>,
  ): Promise<ClassifyResult<z.infer<TSchema>>> {
    const started = Date.now();
    const result = await this.providerCall(CHAT_TIMEOUT_MS, (signal) =>
      generateText({
        model: this.models.chat,
        system: input.system,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        // AI SDK v7 successor of `generateObject` (ADR-0005 intent: typed output).
        output: Output.object({ schema: input.schema }),
        maxOutputTokens: input.maxOutputTokens,
        abortSignal: signal,
      }),
    );

    return {
      object: result.output as z.infer<TSchema>,
      model: this.models.chatModelId,
      usage: {
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      },
      latencyMs: Date.now() - started,
    };
  }
}
