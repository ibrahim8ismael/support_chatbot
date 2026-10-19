import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { InfraModule } from '../infra/infra.module';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { LlmModule } from '../llm/llm.module';
import { IngestDocumentWorker } from './ingest-document.worker';
import { IngestionService } from './ingestion.service';
import { ChildProcessParseRunner, ParseRunner } from './parse-runner';

/**
 * Ingestion — owns `chunks` (T-104). The worker consumes `ingest-document`;
 * parsing/chunking/embedding happens here, stored files + document status stay
 * with knowledge-base, embeddings come from llm. Parsing itself runs in a
 * supervised child process: untrusted files must not share our heap.
 */
@Module({
  imports: [DatabaseModule, InfraModule, KnowledgeBaseModule, LlmModule],
  providers: [
    IngestionService,
    IngestDocumentWorker,
    { provide: ParseRunner, useClass: ChildProcessParseRunner },
  ],
  exports: [IngestionService],
})
export class IngestionModule {}
