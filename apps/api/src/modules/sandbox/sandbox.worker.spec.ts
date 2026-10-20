import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { SandboxRunJob } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { SandboxService } from './sandbox.service';
import { processSandboxRunJob } from './sandbox.worker';

const RUN_ID = '22222222-2222-4222-8222-222222222222';

function buildDeps(error?: Error) {
  const processRun = error
    ? vi.fn(async () => {
        throw error;
      })
    : vi.fn(async () => undefined);
  const markRunFailed = vi.fn(async (_runId: string, _message: string) => undefined);
  const sandbox = { processRun, markRunFailed } as unknown as SandboxService;
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;
  return { sandbox, markRunFailed, logger, processRun };
}

function job(overrides: { attemptsMade?: number; attempts?: number } = {}): Job<SandboxRunJob> {
  return {
    data: { runId: RUN_ID },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job<SandboxRunJob>;
}

describe('processSandboxRunJob', () => {
  it('runs the batch and logs success', async () => {
    const deps = buildDeps();

    await expect(processSandboxRunJob(job(), deps)).resolves.toBeUndefined();
    expect(deps.processRun).toHaveBeenCalledWith(RUN_ID);
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining(RUN_ID),
      'SandboxRunWorker',
    );
    expect(deps.markRunFailed).not.toHaveBeenCalled();
  });

  it('leaves the run resumable while attempts remain', async () => {
    const deps = buildDeps(new Error('redis hiccup'));

    await expect(processSandboxRunJob(job({ attemptsMade: 0 }), deps)).rejects.toThrow(
      'redis hiccup',
    );
    expect(deps.markRunFailed).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('retrying'),
      'SandboxRunWorker',
    );
  });

  it('marks the run failed on the final attempt and rethrows', async () => {
    const deps = buildDeps(new Error('database down'));

    await expect(processSandboxRunJob(job({ attemptsMade: 2 }), deps)).rejects.toThrow(
      'database down',
    );
    expect(deps.markRunFailed).toHaveBeenCalledWith(RUN_ID, 'database down');
  });

  it('truncates long error messages', async () => {
    const deps = buildDeps(new Error('x'.repeat(700)));

    await expect(processSandboxRunJob(job({ attemptsMade: 2 }), deps)).rejects.toThrow();
    const reported = deps.markRunFailed.mock.calls[0]?.[1] ?? '';
    expect(reported).toHaveLength(500);
    expect(reported.endsWith('...')).toBe(true);
  });

  it('still surfaces the original error when marking failed also breaks', async () => {
    const deps = buildDeps(new Error('boom'));
    deps.markRunFailed.mockRejectedValueOnce(new Error('db down'));

    await expect(processSandboxRunJob(job({ attemptsMade: 2 }), deps)).rejects.toThrow('boom');
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('could not mark'),
      'SandboxRunWorker',
    );
  });
});
