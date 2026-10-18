import { Module } from '@nestjs/common';

import { RuntimeMetricsService } from './runtime-metrics.service';

/**
 * Process-local metrics shared by the LLM/webhook paths (writers) and the
 * alert check (reader, T-404).
 */
@Module({
  providers: [RuntimeMetricsService],
  exports: [RuntimeMetricsService],
})
export class MetricsModule {}
