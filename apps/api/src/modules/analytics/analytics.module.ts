import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuditLogController } from './audit-log.controller';

/**
 * Analytics — owns `answer_events` and `audit_logs`. Feature modules import
 * this module and write events through `AnalyticsService`; the dashboard read
 * endpoints (T-302) live on `AnalyticsController`, the admin audit page
 * (T-304) on `AuditLogController`.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController, AuditLogController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
