import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

import type { AppLogger } from '../../common/logger/app-logger.service';
import { DIGEST_JOB_NAME, type DigestService } from './digest';
import { processDigestJob } from './digest.worker';

function buildDeps(run: () => Promise<unknown>) {
  return {
    digest: { run: vi.fn(run) } as unknown as DigestService,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
  };
}

function job(name: string): Job<unknown> {
  return { name } as unknown as Job<unknown>;
}

describe('processDigestJob', () => {
  it('runs the digest and logs the outcome', async () => {
    const deps = buildDeps(async () => ({ itemCount: 3, posted: true }));

    await processDigestJob(job(DIGEST_JOB_NAME), deps);

    expect(deps.digest.run).toHaveBeenCalledOnce();
    expect(deps.logger.log).toHaveBeenCalledWith(
      'weekly digest done: 3 item(s), posted=true',
      'DigestWorker',
    );
  });

  it('logs unknown job names instead of retrying them', async () => {
    const deps = buildDeps(async () => ({ itemCount: 0, posted: false }));

    await processDigestJob(job('some-future-job'), deps);

    expect(deps.digest.run).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      'unknown job "some-future-job" on analytics-followup',
      'DigestWorker',
    );
  });

  it('propagates digest failures so BullMQ retries with backoff', async () => {
    const deps = buildDeps(async () => {
      throw new Error('digest webhook responded 503');
    });

    await expect(processDigestJob(job(DIGEST_JOB_NAME), deps)).rejects.toThrow(
      'digest webhook responded 503',
    );
  });
});
