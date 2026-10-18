import { describe, expect, it } from 'vitest';

import {
  ALERT_CRON,
  ALERT_LIMITS,
  alertCooldownKey,
  evaluateAlerts,
  parseRedisInfo,
  type AlertSnapshot,
} from './alerting';

const MB = 1024 * 1024;

function healthy(): AlertSnapshot {
  return {
    queues: [
      { name: 'reply-job', waiting: 0, oldestWaitingMs: null, failedRecent: 0 },
      { name: 'maintenance', waiting: 0, oldestWaitingMs: null, failedRecent: 0 },
    ],
    llm: { calls: 100, errors: 0 },
    webhook5xx: 0,
    redis: { usedBytes: 100 * MB, maxmemoryBytes: 512 * MB },
  };
}

const options = { redisMemoryLimitBytes: 460 * MB };

describe('evaluateAlerts', () => {
  it('stays quiet on a healthy snapshot', () => {
    expect(evaluateAlerts(healthy(), options)).toEqual([]);
  });

  it('alerts when a queue has more than 50 waiting jobs', () => {
    const snapshot = healthy();
    snapshot.queues[0]!.waiting = 51;

    const alerts = evaluateAlerts(snapshot, options);

    expect(alerts.map((alert) => alert.id)).toEqual(['queue-waiting:reply-job']);
    expect(alerts[0]!.message).toContain('51 waiting');
  });

  it('does not alert at exactly the waiting limit', () => {
    const snapshot = healthy();
    snapshot.queues[0]!.waiting = 50;

    expect(evaluateAlerts(snapshot, options)).toEqual([]);
  });

  it('alerts when the oldest waiting job is older than 10 minutes', () => {
    const snapshot = healthy();
    snapshot.queues[0]!.oldestWaitingMs = 11 * 60_000;

    const alerts = evaluateAlerts(snapshot, options);

    expect(alerts.map((alert) => alert.id)).toEqual(['queue-age:reply-job']);
    expect(alerts[0]!.message).toContain('11 min old');
  });

  it('alerts when more than 5 jobs failed in the last 15 minutes', () => {
    const snapshot = healthy();
    snapshot.queues[1]!.failedRecent = 6;

    expect(evaluateAlerts(snapshot, options).map((alert) => alert.id)).toEqual([
      'queue-failed:maintenance',
    ]);
  });

  it('alerts on an LLM error rate above 5% with at least 5 calls', () => {
    const snapshot = healthy();
    snapshot.llm = { calls: 5, errors: 1 };

    const alerts = evaluateAlerts(snapshot, options);

    expect(alerts.map((alert) => alert.id)).toEqual(['llm-error-rate']);
    expect(alerts[0]!.message).toContain('20.0%');
  });

  it('ignores the LLM rate below the minimum sample size', () => {
    const snapshot = healthy();
    snapshot.llm = { calls: 4, errors: 4 };

    expect(evaluateAlerts(snapshot, options)).toEqual([]);
  });

  it('ignores an LLM error rate at exactly 5%', () => {
    const snapshot = healthy();
    snapshot.llm = { calls: 100, errors: 5 };

    expect(evaluateAlerts(snapshot, options)).toEqual([]);
  });

  it('alerts when webhook 5xx exceed 3 in the window', () => {
    const snapshot = healthy();
    snapshot.webhook5xx = 4;

    expect(evaluateAlerts(snapshot, options).map((alert) => alert.id)).toEqual(['webhook-5xx']);
  });

  it('alerts on Redis above 90% of a configured maxmemory', () => {
    const snapshot = healthy();
    snapshot.redis = { usedBytes: 461 * MB, maxmemoryBytes: 512 * MB };

    const alerts = evaluateAlerts(snapshot, options);

    expect(alerts.map((alert) => alert.id)).toEqual(['redis-memory']);
    expect(alerts[0]!.message).toContain('90%');
  });

  it('falls back to the configured cap when maxmemory is unset', () => {
    const snapshot = healthy();
    snapshot.redis = { usedBytes: 470 * MB, maxmemoryBytes: 0 };

    const alerts = evaluateAlerts(snapshot, options);

    expect(alerts.map((alert) => alert.id)).toEqual(['redis-memory']);
    expect(alerts[0]!.message).toContain('maxmemory unset');
  });

  it('reports every breached condition at once', () => {
    const snapshot = healthy();
    snapshot.queues[0]!.waiting = 60;
    snapshot.queues[0]!.oldestWaitingMs = 20 * 60_000;
    snapshot.llm = { calls: 10, errors: 2 };
    snapshot.webhook5xx = 10;
    snapshot.redis = { usedBytes: 500 * MB, maxmemoryBytes: 512 * MB };

    expect(evaluateAlerts(snapshot, options).map((alert) => alert.id)).toEqual([
      'queue-waiting:reply-job',
      'queue-age:reply-job',
      'llm-error-rate',
      'webhook-5xx',
      'redis-memory',
    ]);
  });

  it('keeps the documented limits', () => {
    expect(ALERT_LIMITS).toMatchObject({
      queueWaiting: 50,
      queueOldestWaitingMs: 10 * 60_000,
      queueFailedRecent: 5,
      llmErrorRate: 0.05,
      webhook5xx: 3,
      redisMemoryRatio: 0.9,
    });
    expect(ALERT_CRON).toBe('*/5 * * * *');
  });
});

describe('parseRedisInfo', () => {
  it('reads numeric fields from INFO memory output', () => {
    const info = '# Memory\r\nused_memory:123456\r\nused_memory_human:120.56K\r\nmaxmemory:0\r\n';

    expect(parseRedisInfo(info, 'used_memory')).toBe(123456);
    expect(parseRedisInfo(info, 'maxmemory')).toBe(0);
    expect(parseRedisInfo(info, 'used_memory_human')).toBe(0);
  });

  it('returns 0 for a missing key', () => {
    expect(parseRedisInfo('used_memory:1\r\n', 'maxmemory')).toBe(0);
  });
});

describe('alertCooldownKey', () => {
  it('namespaces the cooldown per condition', () => {
    expect(alertCooldownKey('redis-memory')).toBe('alert:cooldown:redis-memory');
    expect(alertCooldownKey('queue-age:reply-job')).toBe('alert:cooldown:queue-age:reply-job');
  });
});
