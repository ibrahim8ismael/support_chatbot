import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { RetrievalResult } from '@support-agent/shared';

import type { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { RetrievalController } from './retrieval.controller';
import type { RetrievalService } from './retrieval.service';

const KB_ID = '11111111-1111-4111-8111-111111111111';

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

  return { controller: new RetrievalController(retrieval, knowledgeBase), retrieve, getSummary };
}

describe('RetrievalController.search', () => {
  it('404s before embedding when the KB does not exist', async () => {
    const { controller, retrieve, getSummary } = buildHarness();
    getSummary.mockRejectedValueOnce(new NotFoundException('Knowledge base not found'));

    await expect(controller.search(KB_ID, { query: 'reset' })).rejects.toThrow(NotFoundException);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('delegates to retrieval with the KB id and optional topK', async () => {
    const { controller, retrieve } = buildHarness();

    await expect(controller.search(KB_ID, { query: ' reset ', topK: 3 })).resolves.toBe(RESULT);
    expect(retrieve).toHaveBeenCalledWith(' reset ', [KB_ID], { topK: 3 });

    await controller.search(KB_ID, { query: 'reset' });
    expect(retrieve).toHaveBeenLastCalledWith('reset', [KB_ID], {});
  });
});
