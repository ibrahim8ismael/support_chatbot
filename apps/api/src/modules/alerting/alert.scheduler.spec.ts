import { describe, expect, it, vi } from 'vitest';

import { QUEUES } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { QueueService } from '../infra/queue.service';
import { ALERT_CRON, ALERT_JOB_NAME, ALERT_SCHEDULER_ID } from './alerting';
import { AlertScheduler } from './alert.scheduler';

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
    scheduler: new AlertScheduler(queueService, logger),
    queue,
    upsertJobScheduler,
    logger,
  };
}

describe('AlertScheduler', () => {
  it('upserts the 5-minute schedule on the maintenance queue', async () => {
    const harness = buildHarness();

    await harness.scheduler.onModuleInit();

    expect(harness.queue).toHaveBeenCalledWith(QUEUES.maintenance);
    expect(harness.upsertJobScheduler).toHaveBeenCalledWith(
      ALERT_SCHEDULER_ID,
      { pattern: ALERT_CRON, tz: 'UTC' },
      { name: ALERT_JOB_NAME },
    );
    expect(harness.logger.log).toHaveBeenCalledWith(
      'alert check scheduled (*/5 * * * *, UTC)',
      'AlertScheduler',
    );
  });

  it('never blocks API boot when scheduling fails', async () => {
    const harness = buildHarness({ fail: true });

    await expect(harness.scheduler.onModuleInit()).resolves.toBeUndefined();
    expect(harness.logger.error).toHaveBeenCalledWith(
      'could not schedule the alert check: redis down',
      'AlertScheduler',
    );
  });
});
