import { describe, expect, it, vi } from 'vitest';

import type { AgentChunk } from '@support-agent/shared';

import type { LlmService } from '../src/modules/llm/llm.service';
import { buildJudgeMessage, judgeAnswer, judgeVerdictSchema } from './judge';

const chunks: AgentChunk[] = [
  {
    id: 'c1',
    score: 0.5,
    content: 'Open the sign-in page and choose "Forgot password".',
    document: 'forgot-password.md',
    metadata: {},
  },
];

describe('buildJudgeMessage', () => {
  it('renders the question, the chunks with their document labels, and the answer', () => {
    const message = buildJudgeMessage({
      question: 'How do I reset my password?',
      answer: 'Choose "Forgot password" on the sign-in page.',
      chunks,
    });

    expect(message).toContain('Question: How do I reset my password?');
    expect(message).toContain('[1] (forgot-password.md)');
    expect(message).toContain('Open the sign-in page');
    expect(message).toContain('Answer: Choose "Forgot password" on the sign-in page.');
  });

  it('handles an empty chunk list', () => {
    const message = buildJudgeMessage({ question: 'q', answer: 'a', chunks: [] });
    expect(message).toContain('Knowledge chunks:\n(none)');
  });
});

describe('judgeAnswer', () => {
  it('calls classify with the verdict schema and returns the verdict', async () => {
    const classify = vi.fn(async (_request: unknown) => ({
      object: { verdict: 'unsupported' as const, unsupported_claims: ['invented a refund'] },
      model: 'judge-model',
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
    }));
    const llm = { classify } as unknown as LlmService;

    const result = await judgeAnswer(llm, {
      question: 'How do I reset my password?',
      answer: 'We will refund you.',
      chunks,
    });

    expect(result.verdict.verdict).toBe('unsupported');
    expect(result.verdict.unsupported_claims).toEqual(['invented a refund']);
    expect(result.model).toBe('judge-model');

    const call = classify.mock.calls[0]?.[0] as {
      schema: unknown;
      system: string;
      messages: Array<{ content: string }>;
    };
    expect(call.schema).toBe(judgeVerdictSchema);
    expect(call.system).toContain('grounding judge');
    expect(call.messages[0]?.content).toContain('We will refund you.');
  });
});
