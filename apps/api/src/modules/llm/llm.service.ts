import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { embedMany, generateText, Output } from 'ai';
import type { z } from 'zod';

import { EMBEDDING_DIMENSIONS } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { CacheService } from '../infra/cache.service';
import type {
  ClassifyInput,
  ClassifyResult,
  EmbedResult,
  GenerateReplyInput,
  GenerateReplyResult,
} from './llm.types';
import { createLlmModels, type LlmModels } from './providers/provider.factory';

/** docs/architecture/caching.md: embedding cache TTL is 30 days. */
const EMBEDDING_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** `emb:v1:{model}:sha256(text)` — caching.md; model-qualified so swaps miss. */
export function embeddingCacheKey(modelId: string, text: string): string {
  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  return `emb:v1:${modelId}:${hash}`;
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
  ) {
    // Fails fast at boot on a broken provider config (missing key / unknown provider).
    this.models = createLlmModels(config);
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
    const cached = await Promise.all(keys.map((key) => this.cache.get<number[]>(key)));
    cached.forEach((vector, index) => {
      const key = keys[index];
      if (vector && key) {
        byKey.set(key, vector);
      }
    });

    const misses = [...textByKey.keys()].filter((key) => !byKey.has(key));
    let tokens = 0;

    if (misses.length > 0) {
      const result = await embedMany({
        model: this.models.embedding,
        values: misses.map((key) => textByKey.get(key) ?? ''),
      });
      tokens = result.usage.tokens;

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
          await this.cache.set(key, embedding, EMBEDDING_CACHE_TTL_SECONDS);
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
    const result = await generateText({
      model: this.models.chat,
      system: input.system,
      messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      maxOutputTokens: input.maxOutputTokens,
      temperature: input.temperature,
    });

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
    const result = await generateText({
      model: this.models.chat,
      system: input.system,
      messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      // AI SDK v7 successor of `generateObject` (ADR-0005 intent: typed output).
      output: Output.object({ schema: input.schema }),
      maxOutputTokens: input.maxOutputTokens,
    });

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
