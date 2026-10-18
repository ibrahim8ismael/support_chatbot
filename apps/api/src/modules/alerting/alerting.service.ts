import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { QUEUES } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { RuntimeMetricsService } from '../../common/metrics/runtime-metrics.service';
import { QueueService } from '../infra/queue.service';
import { RedisService } from '../infra/redis.service';
import {
  ALERT_LIMITS,
  alertCooldownKey,
  evaluateAlerts,
  parseRedisInfo,
  type Alert,
  type AlertSnapshot,
  type QueueHealth,
} from './alerting';

const SERVICE_NAME = 'AlertingService';
const DEFAULT_COOLDOWN_MINUTES = 30;
/** ADR-0006: the 512 MB Redis box covers cache + queues; alert before it tops out. */
const DEFAULT_REDIS_MEMORY_MB = 460;
/** Failed jobs fetched per queue when counting the 15-minute window (newest first). */
const FAILED_JOB_SCAN_LIMIT = 1_000;

/**
 * Minimal alerting (T-404, NFR-4): collects queue metrics, in-process LLM /
 * webhook error counters and Redis memory, then posts any breached threshold to
 * `ALERT_WEBHOOK_URL` (unset → warn log). Each condition re-alerts at most once
 * per cooldown window (Redis `SET NX EX`), so a persistent problem is loud but
 * not spammy. Invoked by the `alert-check` job on the `maintenance` queue.
 */
@Injectable()
export class AlertingService {
  private readonly webhookUrl?: string;
  private readonly cooldownSeconds: number;
  private readonly redisMemoryLimitBytes: number;

  constructor(
    config: ConfigService,
    private readonly queueService: QueueService,
    private readonly redis: RedisService,
    private readonly metrics: RuntimeMetricsService,
    private readonly logger: AppLogger,
  ) {
    this.webhookUrl = config.get<string>('ALERT_WEBHOOK_URL') || undefined;
    this.cooldownSeconds =
      (config.get<number>('ALERT_COOLDOWN_MINUTES') ?? DEFAULT_COOLDOWN_MINUTES) * 60;
    this.redisMemoryLimitBytes =
      (config.get<number>('ALERT_REDIS_MEMORY_MB') ?? DEFAULT_REDIS_MEMORY_MB) * 1024 * 1024;
  }

  /** Evaluate thresholds, dedupe via cooldown, deliver to the ops channel. */
  async run(now: Date = new Date()): Promise<Alert[]> {
    const snapshot = await this.collect(now);
    const alerts = evaluateAlerts(snapshot, {
      redisMemoryLimitBytes: this.redisMemoryLimitBytes,
    });

    if (alerts.length === 0) {
      this.logger.debug('alert check: all clear', SERVICE_NAME);
      return alerts;
    }

    await this.deliver(alerts);
    return alerts;
  }

  private async collect(now: Date): Promise<AlertSnapshot> {
    const queues: QueueHealth[] = [];
    for (const name of Object.values(QUEUES)) {
      const queue = this.queueService.queue(name);
      const counts = await queue.getJobCounts('waiting', 'failed');
      const [oldest] = await queue.getJobs(['waiting'], 0, 0, true);
      const failedCount = counts.failed ?? 0;
      const failed =
        failedCount > 0
          ? await queue.getJobs(
              ['failed'],
              0,
              Math.min(failedCount - 1, FAILED_JOB_SCAN_LIMIT - 1),
              false,
            )
          : [];
      const failedFrom = now.getTime() - ALERT_LIMITS.queueFailedWindowMs;

      queues.push({
        name,
        waiting: counts.waiting ?? 0,
        oldestWaitingMs: oldest ? Math.max(0, now.getTime() - oldest.timestamp) : null,
        failedRecent: failed.filter((job) => (job.finishedOn ?? job.timestamp) >= failedFrom)
          .length,
      });
    }

    const info = await this.redis.client.info('memory');

    return {
      queues,
      llm: this.metrics.llmWindow(ALERT_LIMITS.llmWindowMs, now.getTime()),
      webhook5xx: this.metrics.webhook5xx(ALERT_LIMITS.webhookWindowMs, now.getTime()),
      redis: {
        usedBytes: parseRedisInfo(info, 'used_memory'),
        maxmemoryBytes: parseRedisInfo(info, 'maxmemory'),
      },
    };
  }

  private async deliver(alerts: Alert[]): Promise<void> {
    const failed: string[] = [];

    for (const alert of alerts) {
      const key = alertCooldownKey(alert.id);
      const acquired = await this.redis.client.set(key, '1', 'EX', this.cooldownSeconds, 'NX');
      if (!acquired) continue; // already alerted within the cooldown window

      const text = `[support-agent] ${alert.message}`;
      try {
        if (this.webhookUrl) {
          await this.post(text);
        } else {
          this.logger.warn(text, SERVICE_NAME);
        }
      } catch (error) {
        // Clear the cooldown so the BullMQ retry re-sends this one.
        await this.redis.client.del(key);
        failed.push(alert.id);
        this.logger.error(
          `alert delivery failed (${alert.id}): ` +
            `${error instanceof Error ? error.message : String(error)}`,
          SERVICE_NAME,
        );
      }
    }

    if (failed.length > 0) {
      throw new Error(`alert delivery failed for: ${failed.join(', ')}`);
    }
  }

  private async post(text: string): Promise<void> {
    const response = await fetch(this.webhookUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`webhook returned HTTP ${response.status}`);
    }
  }
}
