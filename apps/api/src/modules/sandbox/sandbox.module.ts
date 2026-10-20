import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { AgentModule } from '../agent/agent.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InfraModule } from '../infra/infra.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { SettingsModule } from '../settings/settings.module';
import { SandboxController } from './sandbox.controller';
import { SandboxService } from './sandbox.service';
import { SandboxRunWorker } from './sandbox.worker';

/**
 * Sandbox — owns the accuracy cases, batch runs, and immutable result
 * snapshots (docs/product/sandbox.md). Execution delegates to
 * `AgentService.ask()`; the worker consumes the `sandbox-run` queue.
 */
@Module({
  imports: [
    DatabaseModule,
    InfraModule,
    KnowledgeBaseModule,
    SettingsModule,
    AnalyticsModule,
    AgentModule,
  ],
  controllers: [SandboxController],
  providers: [SandboxService, SandboxRunWorker],
  exports: [SandboxService],
})
export class SandboxModule {}
