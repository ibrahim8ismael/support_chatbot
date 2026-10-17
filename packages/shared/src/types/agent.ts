import type { RetrievedChunkMetadata } from './retrieval';

/**
 * Agent contracts (FR-4/FR-6) — the answer path shared by the playground
 * (T-106) and, later, the live reply pipeline (T-203).
 */

/** Why the bot did not answer (playground scope; the live path adds outcomes). */
export const ESCALATION_REASONS = ['low_score', 'guard'] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

/** One chunk as the answer trace exposes it (rest-api.md § playground). */
export interface AgentChunk {
  id: string;
  score: number;
  content: string;
  /** Display-only source label (filename); never shown to customers. */
  document: string;
  metadata: RetrievedChunkMetadata;
}

export interface AgentLatency {
  retrievalMs: number;
  generationMs: number;
  totalMs: number;
}

export interface AgentTokens {
  input: number;
  output: number;
}

export interface AgentAnswer {
  answer: string;
  escalated: boolean;
  escalationReason: EscalationReason | null;
  /** Chunks that grounded the answer (capped by `context_chunks`). */
  chunks: AgentChunk[];
  latency: AgentLatency;
  tokens: AgentTokens;
  model: string | null;
  /** Versioned prompt file the template came from. */
  promptVersion: string;
}
