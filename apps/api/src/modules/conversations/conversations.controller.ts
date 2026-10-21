import {
  Controller,
  Get,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';

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
import { ChatwootService } from '../chatwoot/chatwoot.service';
import { ConversationsService } from './conversations.service';

/**
 * /api/conversations — the read-only explorer (rest-api.md § Conversations).
 * Viewing is open to every signed-in role; `answer_events` carry customer
 * query text, so the detail endpoint includes them for admins only
 * (security.md § 4).
 */
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    @Optional() private readonly chatwoot?: ChatwootService,
  ) {}

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

  @Roles('editor', 'admin')
  @Post(':id/pause')
  async pause(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'ok' }> {
    const conversation = await this.conversations.findById(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!this.chatwoot) throw new ServiceUnavailableException('Chatwoot is not configured');
    // Persist locally first so the worker stays paused even if Chatwoot is down.
    await this.conversations.setBotState(id, 'paused');
    await this.chatwoot.setConversationLabel(
      conversation.chatwootConversationId,
      'ai-paused',
      true,
    );
    return { status: 'ok' };
  }

  @Roles('editor', 'admin')
  @Post(':id/resume')
  async resume(@Param('id', ParseUUIDPipe) id: string): Promise<{ status: 'ok' }> {
    const conversation = await this.conversations.findById(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (!this.chatwoot) throw new ServiceUnavailableException('Chatwoot is not configured');
    await this.chatwoot.setConversationLabel(
      conversation.chatwootConversationId,
      'ai-paused',
      false,
    );
    await this.chatwoot.setConversationLabel(
      conversation.chatwootConversationId,
      'ai-escalated',
      false,
    );
    await this.conversations.setBotState(id, 'active');
    return { status: 'ok' };
  }
}
