import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { InfraModule } from '../infra/infra.module';
import { RetentionScheduler } from './retention.scheduler';
import { RetentionService } from './retention.service';
import { RetentionWorker } from './retention.worker';

/**
 * Retention (T-403, NFR-7): a daily `retention-cleanup` job on the
 * `maintenance` queue deletes messages/conversations and analytics/audit
 * events older than `RETENTION_DAYS` (default 365). Documents, chunks and KBs
 * are never touched.
 */
@Module({
  imports: [DatabaseModule, InfraModule],
  providers: [RetentionService, RetentionScheduler, RetentionWorker],
})
export class RetentionModule {}
