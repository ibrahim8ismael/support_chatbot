import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import {
  USER_ROLES,
  retrievalSearchSchema,
  type RetrievalResult,
  type RetrievalSearch,
  type SessionUser,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { LlmQuotaService } from '../infra/llm-quota.service';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { RetrievalService } from './retrieval.service';

/**
 * `POST /knowledge-bases/:id/search` — debug retrieval for the dashboard
 * (rest-api.md): real embed + search, no generation. Any signed-in role, but
 * rate-capped per user (and by the global daily budget) — paid embedding calls
 * must not be loopable (backend audit HIGH).
 */
@Controller('knowledge-bases')
export class RetrievalController {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly quota: LlmQuotaService,
  ) {}

  @Roles(...USER_ROLES)
  @Post(':id/search')
  async search(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(retrievalSearchSchema)) body: RetrievalSearch,
    @CurrentUser() user: SessionUser,
  ): Promise<RetrievalResult> {
    await this.quota.enforce(user.id);
    // 404 for unknown KBs before doing any (paid) embedding work.
    await this.knowledgeBase.getSummary(id);
    return this.retrieval.retrieve(body.query, [id], {
      ...(body.topK !== undefined ? { topK: body.topK } : {}),
    });
  }
}
