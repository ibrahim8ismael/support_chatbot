import { describe, expect, it, vi } from 'vitest';

import { QUEUES } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { QueueService } from '../infra/queue.service';
import { DIGEST_CRON, DIGEST_JOB_NAME, DIGEST_SCHEDULER_ID } from './digest';
import { DigestScheduler } from './digest.scheduler';

function buildHarness(options: { fail?: boolean } = {}) {
  const upsertJobScheduler = vi.fn(async (_id: string, _repeat: unknown, _job: unknown) => {
    if (options.fail) {
      throw new Error('redis down');
    }
    return undefined;
  });
  const queue = vi.fn(() => ({ upsertJobScheduler }));
  const queueService = { queue } as unknown as QueueService;
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;

  return {
    scheduler: new DigestScheduler(queueService, logger),
    queue,
    upsertJobScheduler,
    logger,
  };
}

describe('DigestScheduler', () => {
  it('upserts the Monday 09:00 UTC schedule on the analytics-followup queue', async () => {
    const harness = buildHarness();

    await harness.scheduler.onModuleInit();

    expect(harness.queue).toHaveBeenCalledWith(QUEUES.analyticsFollowup);
    expect(harness.upsertJobScheduler).toHaveBeenCalledWith(
      DIGEST_SCHEDULER_ID,
      { pattern: DIGEST_CRON, tz: 'UTC' },
      { name: DIGEST_JOB_NAME },
    );
    expect(DIGEST_CRON).toBe('0 9 * * 1');
    expect(harness.logger.log).toHaveBeenCalledWith(
      'weekly digest scheduled (0 9 * * 1, UTC)',
      'DigestScheduler',
    );
  });

  it('never blocks API boot when scheduling fails', async () => {
    const harness = buildHarness({ fail: true });

    await expect(harness.scheduler.onModuleInit()).resolves.toBeUndefined();
    expect(harness.logger.error).toHaveBeenCalledWith(
      'could not schedule the weekly digest: redis down',
      'DigestScheduler',
    );
  });
});
