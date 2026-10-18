import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { InfraModule } from '../infra/infra.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuditLogController } from './audit-log.controller';
import { DigestScheduler } from './digest.scheduler';
import { DigestWorker } from './digest.worker';
import { DigestService } from './digest';

/**
 * Analytics — owns `answer_events` and `audit_logs`. Feature modules import
 * this module and write events through `AnalyticsService`; the dashboard read
 * endpoints (T-302) live on `AnalyticsController`, the admin audit page
 * (T-304) on `AuditLogController`, and the weekly digest cron (T-305) on the
 * `analytics-followup` queue via `DigestScheduler`/`DigestWorker`.
 */
@Module({
  imports: [DatabaseModule, InfraModule],
  controllers: [AnalyticsController, AuditLogController],
  providers: [AnalyticsService, DigestService, DigestWorker, DigestScheduler],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
