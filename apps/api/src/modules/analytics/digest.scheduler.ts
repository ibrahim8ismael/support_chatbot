import { Injectable, type OnModuleInit } from '@nestjs/common';

import { QUEUES } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { QueueService } from '../infra/queue.service';
import { DIGEST_CRON, DIGEST_JOB_NAME, DIGEST_SCHEDULER_ID } from './digest';

const SCHEDULER_NAME = 'DigestScheduler';

/**
 * Registers the repeatable weekly-digest job (BullMQ job scheduler). Upsert is
 * idempotent, so every boot converges on exactly one schedule — no duplicate
 * runs after restarts. A failure here must not kill the API (the bot answering
 * customers matters more than the digest): log and retry on next boot.
 */
@Injectable()
export class DigestScheduler implements OnModuleInit {
  constructor(
    private readonly queueService: QueueService,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queueService
        .queue(QUEUES.analyticsFollowup)
        .upsertJobScheduler(
          DIGEST_SCHEDULER_ID,
          { pattern: DIGEST_CRON, tz: 'UTC' },
          { name: DIGEST_JOB_NAME },
        );
      this.logger.log(`weekly digest scheduled (${DIGEST_CRON}, UTC)`, SCHEDULER_NAME);
    } catch (error) {
      this.logger.error(
        `could not schedule the weekly digest: ${error instanceof Error ? error.message : String(error)}`,
        SCHEDULER_NAME,
      );
    }
  }
}
