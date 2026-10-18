import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BindingsModule } from '../bindings/bindings.module';
import { InfraModule } from '../infra/infra.module';
import { DocumentsController } from './documents.controller';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { KnowledgeBaseService } from './knowledge-base.service';

/**
 * Knowledge base — owns `knowledge_bases` and `documents`. Uploads land in
 * `UPLOAD_DIR` (D9: Docker volume) and are enqueued for the ingestion worker;
 * bindings is consulted before a KB can be hard-deleted; changes are audited
 * through the analytics writer (T-301).
 */
@Module({
  imports: [DatabaseModule, InfraModule, BindingsModule, AnalyticsModule],
  controllers: [KnowledgeBaseController, DocumentsController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
