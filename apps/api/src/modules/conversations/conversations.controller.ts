import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';

import {
  USER_ROLES,
  conversationListQuerySchema,
  type ConversationDetail,
  type ConversationList,
  type ConversationListQuery,
  type SessionUser,
} from '@support-agent/shared';

import { ZodQueryPipe } from '../../common/pipes/zod-query.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { ConversationsService } from './conversations.service';

/**
 * /api/conversations — the read-only explorer (rest-api.md § Conversations).
 * Viewing is open to every signed-in role; `answer_events` carry customer
 * query text, so the detail endpoint includes them for admins only
 * (security.md § 4).
 */
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Roles(...USER_ROLES)
  @Get()
  list(
    @Query(new ZodQueryPipe(conversationListQuerySchema)) query: ConversationListQuery,
  ): Promise<ConversationList> {
    return this.conversations.listForExplorer(query);
  }

  @Roles(...USER_ROLES)
  @Get(':id')
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: SessionUser,
  ): Promise<ConversationDetail> {
    return this.conversations.detailForExplorer(id, {
      includeAnswerEvents: user.role === 'admin',
    });
  }
}
