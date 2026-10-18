import { Module } from '@nestjs/common';

import { MetricsModule } from '../../common/metrics/metrics.module';
import { InfraModule } from '../infra/infra.module';
import { AlertScheduler } from './alert.scheduler';
import { AlertingService } from './alerting.service';

/**
 * Alerting (T-404, NFR-4): a 5-minute `alert-check` job on the `maintenance`
 * queue evaluates queue depth/age/failures, in-process LLM and webhook error
 * rates, and Redis memory, then posts to the ops channel.
 */
@Module({
  imports: [InfraModule, MetricsModule],
  providers: [AlertingService, AlertScheduler],
  exports: [AlertingService],
})
export class AlertingModule {}
