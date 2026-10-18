import { Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import type { KnowledgeDocument, SessionUser } from '@support-agent/shared';

import { CurrentUser, Roles } from '../auth/auth.decorators';
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
  reprocess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<KnowledgeDocument> {
    return this.knowledgeBase.reprocessDocument(id, user.id);
  }

  /** Hard delete: row, chunks (cascade), stored file. */
  @Roles('editor', 'admin')
  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<{ status: 'ok' }> {
    await this.knowledgeBase.removeDocument(id, user.id);
    return { status: 'ok' };
  }
}
