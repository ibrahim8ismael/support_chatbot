import { Module } from '@nestjs/common';

import { BindingsModule } from '../bindings/bindings.module';
import { ChatwootModule } from '../chatwoot/chatwoot.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InfraModule } from '../infra/infra.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { LlmModule } from '../llm/llm.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { SettingsModule } from '../settings/settings.module';
import { AgentReplyWorker } from './agent-reply.worker';
import { AgentService } from './agent.service';
import { PlaygroundController } from './playground.controller';

/**
 * Agent — the orchestrator/composition point (owns no tables). `ask()` is the
 * answer core: query build → retrieval → threshold gate → grounded prompt →
 * generate → output guard. The playground and Chatwoot reply worker reuse that
 * core; Chatwoot I/O, locking, handoff, and answer-event linkage are composed
 * here through the owning modules.
 */
@Module({
  imports: [
    AnalyticsModule,
    BindingsModule,
    ChatwootModule,
    ConversationsModule,
    InfraModule,
    KnowledgeBaseModule,
    LlmModule,
    RetrievalModule,
    SettingsModule,
  ],
  controllers: [PlaygroundController],
  providers: [AgentService, AgentReplyWorker],
  exports: [AgentService],
})
export class AgentModule {}
