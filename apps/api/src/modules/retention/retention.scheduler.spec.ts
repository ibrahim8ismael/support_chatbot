import { describe, expect, it, vi } from 'vitest';

import { QUEUES } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { QueueService } from '../infra/queue.service';
import { RETENTION_CRON, RETENTION_JOB_NAME, RETENTION_SCHEDULER_ID } from './retention';
import { RetentionScheduler } from './retention.scheduler';

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
    scheduler: new RetentionScheduler(queueService, logger),
    queue,
    upsertJobScheduler,
    logger,
  };
}

describe('RetentionScheduler', () => {
  it('upserts the daily 03:00 UTC schedule on the maintenance queue', async () => {
    const harness = buildHarness();

    await harness.scheduler.onModuleInit();

    expect(harness.queue).toHaveBeenCalledWith(QUEUES.maintenance);
    expect(harness.upsertJobScheduler).toHaveBeenCalledWith(
      RETENTION_SCHEDULER_ID,
      { pattern: RETENTION_CRON, tz: 'UTC' },
      { name: RETENTION_JOB_NAME },
    );
    expect(RETENTION_CRON).toBe('0 3 * * *');
    expect(harness.logger.log).toHaveBeenCalledWith(
      'retention cleanup scheduled (0 3 * * *, UTC)',
      'RetentionScheduler',
    );
  });

  it('never blocks API boot when scheduling fails', async () => {
    const harness = buildHarness({ fail: true });

    await expect(harness.scheduler.onModuleInit()).resolves.toBeUndefined();
    expect(harness.logger.error).toHaveBeenCalledWith(
      'could not schedule retention cleanup: redis down',
      'RetentionScheduler',
    );
  });
});
