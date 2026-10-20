import {
  playgroundAskSchema,
  type AgentAnswer,
  type AgentChunk,
  type AgentLatency,
  type AgentTokens,
  type EscalationReason,
  type PlaygroundAsk,
} from '@support-agent/shared';

/**
 * Playground helpers (T-107) — the pure parts of the ask flow: request
 * building against the shared contract, and rendering helpers for the trace.
 */

/** One completed exchange kept in the client-side thread. */
export interface PlaygroundExchange {
  question: string;
  answer: AgentAnswer;
  /** KBs used for this exchange — prefilled when saving it as a test case. */
  kbIds?: string[];
}

/** The API caps history at 20 turns — keep the last 10 exchanges. */
export const MAX_HISTORY_EXCHANGES = 10;

/** The API caps a request at 10 knowledge bases. */
export const MAX_KB_SELECTION = 10;

export type AskPayloadResult = { ok: true; payload: PlaygroundAsk } | { ok: false; error: string };

/**
 * Build the `/playground/ask` body from the form state, validating against the
 * shared schema so the UI fails exactly where the API would.
 */
export function buildAskPayload(
  question: string,
  kbIds: string[],
  exchanges: PlaygroundExchange[],
): AskPayloadResult {
  if (kbIds.length === 0) {
    return { ok: false, error: 'Pick at least one knowledge base' };
  }
  if (kbIds.length > MAX_KB_SELECTION) {
    return { ok: false, error: `Pick at most ${MAX_KB_SELECTION} knowledge bases` };
  }
  if (question.trim().length === 0) {
    return { ok: false, error: 'Ask a question first' };
  }

  const history = exchanges
    .slice(-MAX_HISTORY_EXCHANGES)
    .flatMap((exchange) => [
      { role: 'user' as const, content: exchange.question },
      { role: 'assistant' as const, content: exchange.answer.answer },
    ])
    .filter((turn) => turn.content.trim().length > 0);

  const parsed = playgroundAskSchema.safeParse({ question, kbIds, history });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid ask request' };
  }
  return { ok: true, payload: parsed.data };
}

/** Similarity, three decimals — the playground shows raw scores on purpose. */
export function formatScore(score: number): string {
  return score.toFixed(3);
}

export function formatLatency(latency: AgentLatency): string {
  return `${latency.totalMs} ms (retrieval ${latency.retrievalMs} · generation ${latency.generationMs})`;
}

export function formatTokens(tokens: AgentTokens): string {
  return `${tokens.input} in / ${tokens.output} out`;
}

/** "guide.pdf · p. 2 · Password reset" — display-only source label. */
export function chunkSource(chunk: AgentChunk): string {
  const parts = [chunk.document];
  if (typeof chunk.metadata.page === 'number') {
    parts.push(`p. ${chunk.metadata.page}`);
  }
  if (chunk.metadata.heading) {
    parts.push(chunk.metadata.heading);
  }
  return parts.join(' · ');
}

export function escalationLabel(reason: EscalationReason | null): string {
  switch (reason) {
    case 'low_score':
      return 'No grounded knowledge — score below the threshold';
    case 'guard':
      return 'Reply blocked by the output guard';
    default:
      return 'Escalated';
  }
}
