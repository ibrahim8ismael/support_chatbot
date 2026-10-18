import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

import type { AppLogger } from '../../common/logger/app-logger.service';
import { RETENTION_JOB_NAME, type RetentionResult } from './retention';
import type { RetentionService } from './retention.service';
import { processRetentionJob } from './retention.worker';

const RESULT: RetentionResult = {
  cutoff: '2025-10-18T00:00:00.000Z',
  deleted: { answer_events: 4, messages: 7, conversations: 2, audit_logs: 1 },
  total: 14,
};

function buildDeps(run: () => Promise<RetentionResult>) {
  return {
    retention: { run: vi.fn(run) } as unknown as RetentionService,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
  };
}

function job(name: string): Job<unknown> {
  return { name } as unknown as Job<unknown>;
}

describe('processRetentionJob', () => {
  it('runs the cleanup and logs the summary', async () => {
    const deps = buildDeps(async () => RESULT);

    await processRetentionJob(job(RETENTION_JOB_NAME), deps);

    expect(deps.retention.run).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      'retention done: cutoff=2025-10-18 deleted=14 ' +
        '(answer_events=4, messages=7, conversations=2, audit_logs=1) — documents/KBs untouched',
      'RetentionWorker',
    );
  });

  it('logs unknown job names instead of retrying them', async () => {
    const deps = buildDeps(async () => RESULT);

    await processRetentionJob(job('some-future-job'), deps);

    expect(deps.retention.run).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      'unknown job "some-future-job" on maintenance',
      'RetentionWorker',
    );
  });

  it('propagates cleanup failures so BullMQ retries with backoff', async () => {
    const deps = buildDeps(async () => {
      throw new Error('deadlock detected');
    });

    await expect(processRetentionJob(job(RETENTION_JOB_NAME), deps)).rejects.toThrow(
      'deadlock detected',
    );
    expect(deps.logger.log).not.toHaveBeenCalled();
  });
});
