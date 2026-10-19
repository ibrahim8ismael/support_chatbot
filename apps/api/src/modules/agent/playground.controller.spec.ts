import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AgentAnswer } from '@support-agent/shared';

import type { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import type { AgentService } from './agent.service';
import { PlaygroundController } from './playground.controller';

const KB_ID = '11111111-1111-4111-8111-111111111111';

const ANSWER: AgentAnswer = {
  answer: 'Reset via Settings.',
  escalated: false,
  escalationReason: null,
  chunks: [],
  latency: { retrievalMs: 1, generationMs: 2, totalMs: 3 },
  tokens: { input: 4, output: 5 },
  model: 'mock-chat',
  promptVersion: 'answer.v2',
};

function buildHarness() {
  const ask = vi.fn(async (_input: unknown) => ANSWER);
  const agent = { ask } as unknown as AgentService;

  const getSummary = vi.fn(async (_id: string) => ({ id: KB_ID }));
  const knowledgeBase = { getSummary } as unknown as KnowledgeBaseService;

  return { controller: new PlaygroundController(agent, knowledgeBase), ask, getSummary };
}

describe('PlaygroundController.ask', () => {
  it('validates each KB once, then answers with defaults', async () => {
    const { controller, ask, getSummary } = buildHarness();

    await expect(
      controller.ask({ question: 'How do I reset?', kbIds: [KB_ID, KB_ID] }),
    ).resolves.toBe(ANSWER);

    expect(getSummary).toHaveBeenCalledTimes(1);
    expect(getSummary).toHaveBeenCalledWith(KB_ID);
    expect(ask).toHaveBeenCalledWith({
      question: 'How do I reset?',
      kbIds: [KB_ID, KB_ID],
      history: [],
    });
  });

  it('404s on an unknown KB without answering', async () => {
    const { controller, ask, getSummary } = buildHarness();
    getSummary.mockRejectedValueOnce(new NotFoundException('Knowledge base not found'));

    await expect(controller.ask({ question: 'q', kbIds: [KB_ID] })).rejects.toThrow(
      NotFoundException,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it('passes history through', async () => {
    const { controller, ask } = buildHarness();
    const history = [{ role: 'user' as const, content: 'earlier' }];

    await controller.ask({ question: 'and now?', kbIds: [KB_ID], history });

    expect(ask).toHaveBeenCalledWith({ question: 'and now?', kbIds: [KB_ID], history });
  });
});
