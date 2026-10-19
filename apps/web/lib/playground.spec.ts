import { describe, expect, it } from 'vitest';

import type { AgentAnswer, AgentChunk } from '@support-agent/shared';

import {
  MAX_HISTORY_EXCHANGES,
  buildAskPayload,
  chunkSource,
  escalationLabel,
  formatLatency,
  formatScore,
  formatTokens,
  type PlaygroundExchange,
} from './playground';

const KB_A = '11111111-1111-4111-8111-111111111111';
const KB_B = '22222222-2222-4222-8222-222222222222';

function answer(text: string): AgentAnswer {
  return {
    answer: text,
    escalated: false,
    escalationReason: null,
    chunks: [],
    latency: { retrievalMs: 1, generationMs: 2, totalMs: 3 },
    tokens: { input: 4, output: 5 },
    model: 'mock-chat',
    promptVersion: 'answer.v2',
  };
}

function exchange(question: string, text = 'ok'): PlaygroundExchange {
  return { question, answer: answer(text) };
}

describe('buildAskPayload', () => {
  it('requires at least one KB and a question', () => {
    expect(buildAskPayload('How do I reset?', [], [])).toEqual({
      ok: false,
      error: 'Pick at least one knowledge base',
    });
    expect(buildAskPayload('   ', [KB_A], [])).toEqual({
      ok: false,
      error: 'Ask a question first',
    });
  });

  it('rejects more than ten KBs', () => {
    const kbIds = Array.from({ length: 11 }, (_, index) => `kb-${index}`);

    expect(buildAskPayload('q', kbIds, [])).toEqual({
      ok: false,
      error: 'Pick at most 10 knowledge bases',
    });
  });

  it('builds a valid payload without history', () => {
    expect(buildAskPayload('How do I reset?', [KB_A], [])).toEqual({
      ok: true,
      payload: { question: 'How do I reset?', kbIds: [KB_A], history: [] },
    });
  });

  it('turns exchanges into user/assistant history in order', () => {
    const built = buildAskPayload(
      'and the price?',
      [KB_A, KB_B],
      [exchange('first question', 'first answer'), exchange('second question', 'second answer')],
    );

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.history).toEqual([
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
        { role: 'user', content: 'second question' },
        { role: 'assistant', content: 'second answer' },
      ]);
      expect(built.payload.kbIds).toEqual([KB_A, KB_B]);
    }
  });

  it('keeps only the last ten exchanges', () => {
    const exchanges = Array.from({ length: 12 }, (_, index) =>
      exchange(`q${index + 1}`, `a${index + 1}`),
    );

    const built = buildAskPayload('q', [KB_A], exchanges);

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.history).toHaveLength(MAX_HISTORY_EXCHANGES * 2);
      expect(built.payload.history?.[0]).toEqual({ role: 'user', content: 'q3' });
    }
  });

  it('drops empty history entries', () => {
    const built = buildAskPayload('q', [KB_A], [exchange('q1', '   ')]);

    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.history).toEqual([{ role: 'user', content: 'q1' }]);
    }
  });
});

describe('display helpers', () => {
  it('formats scores to three decimals', () => {
    expect(formatScore(0.53646)).toBe('0.536');
  });

  it('formats latency and tokens', () => {
    expect(formatLatency({ retrievalMs: 18, generationMs: 19, totalMs: 45 })).toBe(
      '45 ms (retrieval 18 · generation 19)',
    );
    expect(formatTokens({ input: 169, output: 8 })).toBe('169 in / 8 out');
  });

  it('labels escalation reasons', () => {
    expect(escalationLabel('low_score')).toMatch(/threshold/);
    expect(escalationLabel('guard')).toMatch(/guard/);
    expect(escalationLabel(null)).toBe('Escalated');
  });

  it('builds chunk source labels from metadata', () => {
    const chunk: AgentChunk = {
      id: 'c1',
      score: 0.5,
      content: 'x',
      document: 'reset-guide.pdf',
      metadata: { page: 2, heading: 'Password reset' },
    };

    expect(chunkSource(chunk)).toBe('reset-guide.pdf · p. 2 · Password reset');
    expect(chunkSource({ ...chunk, metadata: {} })).toBe('reset-guide.pdf');
  });
});
