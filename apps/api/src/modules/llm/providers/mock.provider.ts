import { createHash } from 'node:crypto';

import type {
  EmbeddingModelV3,
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Result,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';

import { EMBEDDING_DIMENSIONS } from '@support-agent/shared';

/**
 * Deterministic, network-free models behind `LLM_PROVIDER=mock`
 * (docs/contributing/development.md). Dev and CI run the whole pipeline with
 * these; real providers are wired when decision D2 closes.
 */

export const MOCK_EMBEDDING_MODEL_ID = 'mock-embedding-1536';
export const MOCK_CHAT_MODEL_ID = 'mock-chat';

/** Mirrors the batch limits real providers document (OpenAI: 2048, we use less). */
const MOCK_MAX_EMBEDDINGS_PER_CALL = 100;

/** Rough token estimate for accounting only — words, not BPE. */
export function estimateTokens(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

/**
 * Feature-hash embedding: every word sets one dimension, with a sign from its
 * sha-256. Texts that share words get a higher cosine similarity, so retrieval
 * and chunking plumbing can be exercised locally; these are *not* semantic
 * embeddings. Always the same vector for the same text (deterministic).
 */
export function mockEmbedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const token of tokens) {
    const digest = createHash('sha256').update(token, 'utf8').digest();
    const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    const sign = digest.readUInt8(4) % 2 === 0 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

/**
 * Deterministic sample of a JSON schema, used when `generateObject` asks the
 * mock chat model for structured output. Heuristics: enums → first member,
 * nullable → null (mock says "nothing to report"), booleans → true, numbers →
 * 0, arrays → []. Enough for classification-shaped schemas; string formats
 * (emails, uuids) are intentionally not modelled.
 */
export function mockJsonFromSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') {
    return null;
  }

  const node = schema as Record<string, unknown>;

  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum[0];
  }

  const types: string[] = Array.isArray(node.type)
    ? (node.type as string[])
    : typeof node.type === 'string'
      ? [node.type]
      : [];

  if (types.includes('null')) {
    return null;
  }

  if (types.includes('object') || node.properties !== undefined) {
    const properties = (node.properties ?? {}) as Record<string, unknown>;
    const sample: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      sample[key] = mockJsonFromSchema(value);
    }
    return sample;
  }

  if (types.includes('array')) {
    return [];
  }

  if (types.includes('boolean')) {
    return true;
  }

  if (types.includes('integer') || types.includes('number')) {
    return 0;
  }

  if (types.includes('string')) {
    return 'mock';
  }

  const variants = (node.anyOf ?? node.oneOf) as unknown[] | undefined;
  if (Array.isArray(variants) && variants.length > 0) {
    const allowsNull = variants.some(
      (variant) =>
        variant !== null &&
        typeof variant === 'object' &&
        (variant as Record<string, unknown>).type === 'null',
    );
    return allowsNull ? null : mockJsonFromSchema(variants[0]);
  }

  return null;
}

function messageText(message: LanguageModelV3Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ');
}

function lastUserText(prompt: LanguageModelV3Prompt): string {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index];
    if (message?.role === 'user') {
      return messageText(message);
    }
  }
  return '';
}

class FeatureHashEmbeddingModel implements EmbeddingModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'mock';
  readonly modelId = MOCK_EMBEDDING_MODEL_ID;
  readonly maxEmbeddingsPerCall = MOCK_MAX_EMBEDDINGS_PER_CALL;
  readonly supportsParallelCalls = true;

  async doEmbed(options: EmbeddingModelV3CallOptions): Promise<EmbeddingModelV3Result> {
    return {
      embeddings: options.values.map((value) => mockEmbedText(value)),
      usage: {
        tokens: options.values.reduce((sum, value) => sum + estimateTokens(value), 0),
      },
      warnings: [],
    };
  }
}

class EchoLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'mock';
  readonly modelId = MOCK_CHAT_MODEL_ID;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const promptText = options.prompt.map((message) => messageText(message)).join('\n');
    const responseFormat = options.responseFormat;

    // M0 loop behaviour (docs/product/roadmap.md): echo the customer message.
    const text =
      responseFormat?.type === 'json'
        ? JSON.stringify(mockJsonFromSchema(responseFormat.schema))
        : `I received: ${lastUserText(options.prompt)}`;

    const inputTokens = estimateTokens(promptText);
    const outputTokens = estimateTokens(text);

    return {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'mock' },
      usage: {
        inputTokens: {
          total: inputTokens,
          noCache: inputTokens,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
      },
      warnings: [],
    };
  }

  doStream(): Promise<LanguageModelV3StreamResult> {
    return Promise.reject(
      new Error('the mock provider does not stream — generation is non-streamed (ADR-0005)'),
    );
  }
}

export function createFeatureHashEmbeddingModel(): EmbeddingModelV3 {
  return new FeatureHashEmbeddingModel();
}

export function createEchoLanguageModel(): LanguageModelV3 {
  return new EchoLanguageModel();
}
