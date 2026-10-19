import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { InfraModule } from '../infra/infra.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { LlmModule } from '../llm/llm.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { SettingsModule } from '../settings/settings.module';
import { AgentService } from './agent.service';
import { PlaygroundController } from './playground.controller';

/**
 * Agent — the orchestrator/composition point (owns no tables). `ask()` is the
 * answer core: query build → retrieval → threshold gate → grounded prompt →
 * generate → output guard. The playground is wired now; the live reply
 * pipeline adds Chatwoot I/O, locking, and full `answer_events` context
 * (T-203/T-204) through the analytics writer.
 */
@Module({
  imports: [
    AnalyticsModule,
    InfraModule,
    KnowledgeBaseModule,
    LlmModule,
    RetrievalModule,
    SettingsModule,
  ],
  controllers: [PlaygroundController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
