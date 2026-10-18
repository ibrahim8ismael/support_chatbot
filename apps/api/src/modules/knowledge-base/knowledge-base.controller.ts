import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  MAX_DOCUMENT_BYTES,
  USER_ROLES,
  knowledgeBaseInputSchema,
  knowledgeBaseUpdateSchema,
  type DocumentStatus,
  type KnowledgeBaseInput,
  type KnowledgeBaseSummary,
  type KnowledgeBaseUpdate,
  type KnowledgeDocument,
  type SessionUser,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { KnowledgeBaseService, type UploadedDocumentFile } from './knowledge-base.service';

/**
 * /api/knowledge-bases — KB + document management (docs/api/rest-api.md).
 * Viewing is open to every signed-in role; mutations follow the security
 * matrix (editor/admin, docs/operations/security.md § 2).
 *
 * Uploads are held in memory by multer only up to `MAX_DOCUMENT_BYTES`
 * (larger → 413) and then validated/sniffed before touching the disk.
 */
@Controller('knowledge-bases')
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBase: KnowledgeBaseService) {}

  @Roles(...USER_ROLES)
  @Get()
  list(): Promise<KnowledgeBaseSummary[]> {
    return this.knowledgeBase.list();
  }

  @Roles('editor', 'admin')
  @Post()
  create(
    @Body(new ZodBodyPipe(knowledgeBaseInputSchema)) body: KnowledgeBaseInput,
    @CurrentUser() user: SessionUser,
  ): Promise<KnowledgeBaseSummary> {
    return this.knowledgeBase.create(body, user.id);
  }

  @Roles(...USER_ROLES)
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<KnowledgeBaseSummary> {
    return this.knowledgeBase.getSummary(id);
  }

  @Roles('editor', 'admin')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(knowledgeBaseUpdateSchema)) body: KnowledgeBaseUpdate,
    @CurrentUser() user: SessionUser,
  ): Promise<KnowledgeBaseSummary> {
    return this.knowledgeBase.update(id, body, user.id);
  }

  @Roles('editor', 'admin')
  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<{ status: 'ok' }> {
    await this.knowledgeBase.remove(id, user.id);
    return { status: 'ok' };
  }

  @Roles(...USER_ROLES)
  @Get(':id/documents')
  listDocuments(@Param('id', ParseUUIDPipe) id: string): Promise<KnowledgeDocument[]> {
    return this.knowledgeBase.listDocuments(id);
  }

  @Roles('editor', 'admin')
  @Post(':id/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      // Default (memory) storage is fine: multer caps the buffer at 20 MB.
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    }),
  )
  uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @CurrentUser() user: SessionUser,
  ): Promise<{ documentId: string; status: DocumentStatus }> {
    return this.knowledgeBase.uploadDocument(id, file, user.id);
  }
}
