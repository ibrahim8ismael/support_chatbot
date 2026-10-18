import { Injectable, type OnModuleInit } from '@nestjs/common';

import { QUEUES } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { QueueService } from '../infra/queue.service';
import { RETENTION_CRON, RETENTION_JOB_NAME, RETENTION_SCHEDULER_ID } from './retention';

const SCHEDULER_NAME = 'RetentionScheduler';

/**
 * Registers the daily retention cleanup as a BullMQ job scheduler. Upsert is
 * idempotent, so every boot converges on exactly one schedule. A scheduling
 * failure must not kill the API (answering customers matters more): log and
 * retry on next boot.
 */
@Injectable()
export class RetentionScheduler implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queueService
        .queue(QUEUES.maintenance)
        .upsertJobScheduler(
          RETENTION_SCHEDULER_ID,
          { pattern: RETENTION_CRON, tz: 'UTC' },
          { name: RETENTION_JOB_NAME },
        );
      this.logger.log(`retention cleanup scheduled (${RETENTION_CRON}, UTC)`, SCHEDULER_NAME);
    } catch (error) {
      this.logger.error(
        `could not schedule retention cleanup: ${error instanceof Error ? error.message : String(error)}`,
        SCHEDULER_NAME,
      );
    }
  }
}
