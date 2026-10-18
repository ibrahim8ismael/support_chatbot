/**
 * Minimal alerting (T-404, NFR-4): a 5-minute `alert-check` job on the
 * `maintenance` queue evaluates the thresholds below and posts Slack-compatible
 * `{"text": …}` messages to ALERT_WEBHOOK_URL (unset → warn log). Thresholds
 * mirror docs/operations/deployment.md § Observability & alerting.
 *
 * Everything here is DB/Redis-free so the decision logic unit-tests without a
 * stack; `alerting.service.ts` collects the snapshot and delivers the result.
 */
export const ALERT_JOB_NAME = 'alert-check';
/** Job-scheduler id — BullMQ upserts by id, so restarts never duplicate the schedule. */
export const ALERT_SCHEDULER_ID = 'alert-check';
/** Every 5 minutes — the shortest window in the threshold set. */
export const ALERT_CRON = '*/5 * * * *';

export const ALERT_LIMITS = {
  /** queue `waiting` > 50 */
  queueWaiting: 50,
  /** oldest waiting job > 10 min */
  queueOldestWaitingMs: 10 * 60_000,
  /** queue `failed` > 5 in 15 min */
  queueFailedRecent: 5,
  queueFailedWindowMs: 15 * 60_000,
  /** LLM error rate > 5% in 5 min (requires at least 5 calls — no single-sample noise) */
  llmErrorRate: 0.05,
  llmMinCalls: 5,
  llmWindowMs: 5 * 60_000,
  /** webhook 5xx > 3 in 10 min */
  webhook5xx: 3,
  webhookWindowMs: 10 * 60_000,
  /** Redis memory > 90% of `maxmemory` */
  redisMemoryRatio: 0.9,
} as const;

export interface QueueHealth {
  name: string;
  waiting: number;
  oldestWaitingMs: number | null;
  failedRecent: number;
}

export interface AlertSnapshot {
  queues: QueueHealth[];
  llm: { calls: number; errors: number };
  webhook5xx: number;
  redis: { usedBytes: number; maxmemoryBytes: number };
}

export interface Alert {
  /** Stable id — also the cooldown key suffix. */
  id: string;
  message: string;
}

export interface AlertOptions {
  /** Fallback cap when Redis `maxmemory` is unset (ADR-0006: 512 MB box). */
  redisMemoryLimitBytes: number;
}

export function alertCooldownKey(id: string): string {
  return `alert:cooldown:${id}`;
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Turn a health snapshot into the alerts that should page someone. Every check
 * is "strictly greater than" the documented limit, so e.g. exactly 3 webhook
 * 5xx stays quiet.
 */
export function evaluateAlerts(snapshot: AlertSnapshot, options: AlertOptions): Alert[] {
  const alerts: Alert[] = [];

  for (const queue of snapshot.queues) {
    if (queue.waiting > ALERT_LIMITS.queueWaiting) {
      alerts.push({
        id: `queue-waiting:${queue.name}`,
        message: `queue ${queue.name}: ${queue.waiting} waiting (> ${ALERT_LIMITS.queueWaiting})`,
      });
    }
    if (
      queue.oldestWaitingMs !== null &&
      queue.oldestWaitingMs > ALERT_LIMITS.queueOldestWaitingMs
    ) {
      alerts.push({
        id: `queue-age:${queue.name}`,
        message:
          `queue ${queue.name}: oldest waiting job ` +
          `${Math.floor(queue.oldestWaitingMs / 60_000)} min old (> 10 min)`,
      });
    }
    if (queue.failedRecent > ALERT_LIMITS.queueFailedRecent) {
      alerts.push({
        id: `queue-failed:${queue.name}`,
        message:
          `queue ${queue.name}: ${queue.failedRecent} failed in the last 15 min ` +
          `(> ${ALERT_LIMITS.queueFailedRecent})`,
      });
    }
  }

  const { calls, errors } = snapshot.llm;
  if (calls >= ALERT_LIMITS.llmMinCalls && errors / calls > ALERT_LIMITS.llmErrorRate) {
    alerts.push({
      id: 'llm-error-rate',
      message:
        `LLM error rate ${((errors / calls) * 100).toFixed(1)}% in the last 5 min ` +
        `(${errors}/${calls} calls, > 5%)`,
    });
  }

  if (snapshot.webhook5xx > ALERT_LIMITS.webhook5xx) {
    alerts.push({
      id: 'webhook-5xx',
      message: `webhook 5xx: ${snapshot.webhook5xx} in the last 10 min (> ${ALERT_LIMITS.webhook5xx})`,
    });
  }

  const { usedBytes, maxmemoryBytes } = snapshot.redis;
  if (maxmemoryBytes > 0) {
    const ratio = usedBytes / maxmemoryBytes;
    if (ratio > ALERT_LIMITS.redisMemoryRatio) {
      alerts.push({
        id: 'redis-memory',
        message:
          `redis memory ${mb(usedBytes)} MB of ${mb(maxmemoryBytes)} MB ` +
          `(${Math.round(ratio * 100)}% > 90%)`,
      });
    }
  } else if (usedBytes > options.redisMemoryLimitBytes) {
    alerts.push({
      id: 'redis-memory',
      message:
        `redis memory ${mb(usedBytes)} MB (> ${mb(options.redisMemoryLimitBytes)} MB cap; ` +
        'maxmemory unset)',
    });
  }

  return alerts;
}

/** `INFO memory` is `key:value` lines; missing keys → 0. */
export function parseRedisInfo(info: string, key: string): number {
  const match = new RegExp(`^${key}:(\\d+)$`, 'm').exec(info);
  return match ? Number(match[1]) : 0;
}
