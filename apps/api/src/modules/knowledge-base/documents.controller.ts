import { Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import type { KnowledgeDocument } from '@support-agent/shared';

import { Roles } from '../auth/auth.decorators';
import { KnowledgeBaseService } from './knowledge-base.service';

/**
 * /api/documents — document-level actions that don't need the KB in the path.
 * Editor/admin per the security matrix (docs/operations/security.md § 2).
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly knowledgeBase: KnowledgeBaseService) {}

  /** Reset status and re-run parse → chunk → embed (idempotent replace). */
  @Roles('editor', 'admin')
  @Post(':id/reprocess')
  reprocess(@Param('id', ParseUUIDPipe) id: string): Promise<KnowledgeDocument> {
    return this.knowledgeBase.reprocessDocument(id);
  }

  /** Hard delete: row, chunks (cascade), stored file. */
  @Roles('editor', 'admin')
  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'ok' }> {
    await this.knowledgeBase.removeDocument(id);
    return { status: 'ok' };
  }
}
