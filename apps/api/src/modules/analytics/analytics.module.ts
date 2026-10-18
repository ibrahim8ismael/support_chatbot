import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics — owns `answer_events` and `audit_logs`. Feature modules import
 * this module and write events through `AnalyticsService`; the dashboard read
 * endpoints (T-302) live on `AnalyticsController`.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
