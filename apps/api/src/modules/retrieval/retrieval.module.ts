import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { InfraModule } from '../infra/infra.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { LlmModule } from '../llm/llm.module';
import { SettingsModule } from '../settings/settings.module';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

/**
 * Retrieval — reads `chunks`, exposes `retrieve(query, kbIds, opts)`.
 * Search traces feed `answer_events`, written by the agent (T-106), which
 * owns conversation/message context; this module never writes events itself.
 */
@Module({
  imports: [DatabaseModule, InfraModule, KnowledgeBaseModule, LlmModule, SettingsModule],
  controllers: [RetrievalController],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
