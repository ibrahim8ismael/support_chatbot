import type { z } from 'zod';

/** One conversation turn for chat/messages-style calls. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface EmbedResult {
  /** Vectors in the same order as the input texts. */
  embeddings: number[][];
  /** Provider-qualified model id (cache namespace + analytics). */
  model: string;
  dimensions: number;
  /** Provider tokens spent on this call (0 when every text was cached). */
  tokens: number;
  /** Input texts served from the Redis embedding cache. */
  cacheHits: number;
  latencyMs: number;
}

export interface GenerateReplyInput {
  system: string;
  messages: ChatTurn[];
  maxOutputTokens?: number;
  temperature?: number;
}

export interface GenerateReplyResult {
  text: string;
  model: string;
  usage: TokenUsage;
  finishReason: string;
  latencyMs: number;
}

export interface ClassifyInput<TSchema extends z.ZodType> {
  system: string;
  messages: ChatTurn[];
  /** Caller-owned schema — prompt *policy* stays in the calling module. */
  schema: TSchema;
  maxOutputTokens?: number;
}

export interface ClassifyResult<TObject> {
  object: TObject;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
}
