import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { IngestDocumentJob } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import type { IngestionService } from './ingestion.service';
import { processIngestDocumentJob } from './ingest-document.worker';

const DOC_ID = '22222222-2222-4222-8222-222222222222';

function buildDeps(options: { outcome?: 'skipped' | 'ingested'; error?: Error } = {}) {
  const ingest = options.error
    ? vi.fn(async () => {
        throw options.error;
      })
    : vi.fn(async () => options.outcome ?? 'ingested');
  const ingestion = { ingest } as unknown as IngestionService;

  const markDocumentFailed = vi.fn(async (_id: string, _error: string) => undefined);
  const knowledgeBase = { markDocumentFailed } as unknown as KnowledgeBaseService;

  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;

  return { ingestion, knowledgeBase, markDocumentFailed, logger, ingest };
}

function job(overrides: { attemptsMade?: number; attempts?: number } = {}): Job<IngestDocumentJob> {
  return {
    data: { documentId: DOC_ID },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job<IngestDocumentJob>;
}

describe('processIngestDocumentJob', () => {
  it('logs the outcome on success', async () => {
    const deps = buildDeps();

    await expect(processIngestDocumentJob(job(), deps)).resolves.toBeUndefined();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('ingested'),
      'IngestDocumentWorker',
    );
    expect(deps.markDocumentFailed).not.toHaveBeenCalled();
  });

  it('leaves the document processing while attempts remain', async () => {
    const deps = buildDeps({ error: new Error('parse blew up') });

    await expect(processIngestDocumentJob(job({ attemptsMade: 0 }), deps)).rejects.toThrow(
      'parse blew up',
    );
    expect(deps.markDocumentFailed).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('retrying'),
      'IngestDocumentWorker',
    );
  });

  it('marks the document failed on the final attempt and rethrows', async () => {
    const deps = buildDeps({ error: new Error('parse blew up') });

    await expect(processIngestDocumentJob(job({ attemptsMade: 2 }), deps)).rejects.toThrow(
      'parse blew up',
    );
    expect(deps.markDocumentFailed).toHaveBeenCalledWith(DOC_ID, 'parse blew up');
  });

  it('truncates long error messages', async () => {
    const long = 'x'.repeat(600);
    const deps = buildDeps({ error: new Error(long) });

    await expect(processIngestDocumentJob(job({ attemptsMade: 2 }), deps)).rejects.toThrow();
    const reported = deps.markDocumentFailed.mock.calls[0]?.[1] ?? '';
    expect(reported).toHaveLength(500);
    expect(reported.endsWith('...')).toBe(true);
  });

  it('still surfaces the original error when marking failed also breaks', async () => {
    const deps = buildDeps({ error: new Error('boom') });
    deps.markDocumentFailed.mockRejectedValueOnce(new Error('db down'));

    await expect(processIngestDocumentJob(job({ attemptsMade: 2 }), deps)).rejects.toThrow('boom');
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('could not mark'),
      'IngestDocumentWorker',
    );
  });
});
