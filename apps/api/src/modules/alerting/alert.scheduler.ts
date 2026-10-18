import { Injectable, type OnModuleInit } from '@nestjs/common';

import { QUEUES } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { QueueService } from '../infra/queue.service';
import { ALERT_CRON, ALERT_JOB_NAME, ALERT_SCHEDULER_ID } from './alerting';

const SCHEDULER_NAME = 'AlertScheduler';

/**
 * Registers the 5-minute alert check as a BullMQ job scheduler. Upsert is
 * idempotent, so every boot converges on exactly one schedule. A scheduling
 * failure must not kill the API: log and retry on next boot.
 */
@Injectable()
export class AlertScheduler implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queueService
        .queue(QUEUES.maintenance)
        .upsertJobScheduler(
          ALERT_SCHEDULER_ID,
          { pattern: ALERT_CRON, tz: 'UTC' },
          { name: ALERT_JOB_NAME },
        );
      this.logger.log(`alert check scheduled (${ALERT_CRON}, UTC)`, SCHEDULER_NAME);
    } catch (error) {
      this.logger.error(
        `could not schedule the alert check: ${error instanceof Error ? error.message : String(error)}`,
        SCHEDULER_NAME,
      );
    }
  }
}
