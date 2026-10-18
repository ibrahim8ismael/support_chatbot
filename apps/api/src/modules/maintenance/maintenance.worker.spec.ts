import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { AlertingService } from '../alerting/alerting.service';
import { ALERT_JOB_NAME, type Alert } from '../alerting/alerting';
import { RETENTION_JOB_NAME, type RetentionResult } from '../retention/retention';
import type { RetentionService } from '../retention/retention.service';
import { processMaintenanceJob } from './maintenance.worker';

const RETENTION_RESULT: RetentionResult = {
  cutoff: '2025-10-18T00:00:00.000Z',
  deleted: { answer_events: 4, messages: 7, conversations: 2, audit_logs: 1 },
  total: 14,
};

function job(name: string): Job<unknown> {
  return { name } as unknown as Job<unknown>;
}

function buildDeps(
  overrides: { retention?: () => Promise<unknown>; alerting?: () => Promise<unknown> } = {},
) {
  return {
    retention: {
      run: vi.fn(overrides.retention ?? (async () => RETENTION_RESULT)),
    } as unknown as RetentionService,
    alerting: {
      run: vi.fn(overrides.alerting ?? (async () => [] as Alert[])),
    } as unknown as AlertingService,
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger,
  };
}

describe('processMaintenanceJob', () => {
  it('runs the retention cleanup and logs the summary', async () => {
    const deps = buildDeps();

    await processMaintenanceJob(job(RETENTION_JOB_NAME), deps);

    expect(deps.retention.run).toHaveBeenCalledOnce();
    expect(deps.alerting.run).not.toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith(
      'retention done: cutoff=2025-10-18 deleted=14 ' +
        '(answer_events=4, messages=7, conversations=2, audit_logs=1) — documents/KBs untouched',
      'MaintenanceWorker',
    );
  });

  it('runs the alert check and reports raised alerts', async () => {
    const alerts: Alert[] = [{ id: 'webhook-5xx', message: 'webhook 5xx: 4 in the last 10 min' }];
    const deps = buildDeps({ alerting: async () => alerts });

    await processMaintenanceJob(job(ALERT_JOB_NAME), deps);

    expect(deps.alerting.run).toHaveBeenCalledOnce();
    expect(deps.retention.run).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(
      'alert check raised 1 alert(s)',
      'MaintenanceWorker',
    );
  });

  it('stays quiet when the alert check is all clear', async () => {
    const deps = buildDeps();

    await processMaintenanceJob(job(ALERT_JOB_NAME), deps);

    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  it('logs unknown job names instead of retrying them', async () => {
    const deps = buildDeps();

    await processMaintenanceJob(job('some-future-job'), deps);

    expect(deps.retention.run).not.toHaveBeenCalled();
    expect(deps.alerting.run).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(
      'unknown job "some-future-job" on maintenance',
      'MaintenanceWorker',
    );
  });

  it('propagates failures so BullMQ retries with backoff', async () => {
    const deps = buildDeps({
      alerting: async () => {
        throw new Error('alert delivery failed');
      },
    });

    await expect(processMaintenanceJob(job(ALERT_JOB_NAME), deps)).rejects.toThrow(
      'alert delivery failed',
    );
  });
});
