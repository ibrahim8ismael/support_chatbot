import { Module } from '@nestjs/common';

import { AlertingModule } from '../alerting/alerting.module';
import { InfraModule } from '../infra/infra.module';
import { RetentionModule } from '../retention/retention.module';
import { MaintenanceWorker } from './maintenance.worker';

/**
 * Maintenance queue worker (T-403/T-404): one BullMQ consumer for all cron-ish
 * jobs — retention cleanup, alert check. Schedulers live with their owning
 * modules; they only enqueue here.
 */
@Module({
  imports: [InfraModule, RetentionModule, AlertingModule],
  providers: [MaintenanceWorker],
})
export class MaintenanceModule {}
