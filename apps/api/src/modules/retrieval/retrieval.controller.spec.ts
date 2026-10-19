import { HttpException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { RetrievalResult, SessionUser } from '@support-agent/shared';

import type { LlmQuotaService } from '../infra/llm-quota.service';
import type { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { RetrievalController } from './retrieval.controller';
import type { RetrievalService } from './retrieval.service';

const KB_ID = '11111111-1111-4111-8111-111111111111';
const USER: SessionUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'editor@example.com',
  name: 'Ed',
  role: 'editor',
};

const RESULT: RetrievalResult = {
  chunks: [],
  trace: {
    query: 'reset',
    normalizedQuery: 'reset',
    kbIds: [KB_ID],
    topK: 10,
    threshold: 0.35,
    bestScore: null,
    returnedChunks: 0,
    cacheHit: false,
    embeddingMs: 0,
    searchMs: 0,
    totalMs: 1,
  },
};

function buildHarness() {
  const retrieve = vi.fn(async (_query: string, _kbIds: string[], _options: unknown) => RESULT);
  const retrieval = { retrieve } as unknown as RetrievalService;

  const getSummary = vi.fn(async (_id: string) => ({ id: KB_ID }));
  const knowledgeBase = { getSummary } as unknown as KnowledgeBaseService;

  const enforce = vi.fn(async (_userId: string) => undefined);
  const quota = { enforce } as unknown as LlmQuotaService;

  return {
    controller: new RetrievalController(retrieval, knowledgeBase, quota),
    retrieve,
    getSummary,
    enforce,
  };
}

describe('RetrievalController.search', () => {
  it('enforces the LLM quota before any paid work', async () => {
    const { controller, retrieve, getSummary, enforce } = buildHarness();
    enforce.mockRejectedValueOnce(new HttpException('quota', 429));

    await expect(controller.search(KB_ID, { query: 'reset' }, USER)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(getSummary).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('404s before embedding when the KB does not exist', async () => {
    const { controller, retrieve, getSummary, enforce } = buildHarness();
    getSummary.mockRejectedValueOnce(new NotFoundException('Knowledge base not found'));

    await expect(controller.search(KB_ID, { query: 'reset' }, USER)).rejects.toThrow(
      NotFoundException,
    );
    expect(enforce).toHaveBeenCalledWith(USER.id);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('delegates to retrieval with the KB id and optional topK', async () => {
    const { controller, retrieve } = buildHarness();

    await expect(controller.search(KB_ID, { query: ' reset ', topK: 3 }, USER)).resolves.toBe(
      RESULT,
    );
    expect(retrieve).toHaveBeenCalledWith(' reset ', [KB_ID], { topK: 3 });

    await controller.search(KB_ID, { query: 'reset' }, USER);
    expect(retrieve).toHaveBeenLastCalledWith('reset', [KB_ID], {});
  });
});
