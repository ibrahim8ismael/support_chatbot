import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics — owns `answer_events` and `audit_logs`. Feature modules import
 * this module and write events through `AnalyticsService`; aggregation
 * endpoints land with T-302.
 */
@Module({
  imports: [DatabaseModule],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
