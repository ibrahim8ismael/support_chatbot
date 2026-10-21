import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Param,
  ParseIntPipe,
  Put,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  bindingUpdateSchema,
  type BindingUpdate,
  type InboxBinding,
  type SessionUser,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { ChatwootService, type ChatwootInbox } from '../chatwoot/chatwoot.service';
import { BindingsService } from './bindings.service';

/**
 * /api/bindings — inbox ↔ KB mapping (docs/api/rest-api.md). Editors manage
 * bindings per the security matrix (docs/operations/security.md § 2).
 * The account-only inbox discovery endpoint delegates to the Chatwoot module.
 */
@Controller('bindings')
export class BindingsController {
  constructor(
    private readonly bindings: BindingsService,
    @Optional() private readonly chatwoot?: ChatwootService,
  ) {}

  @Roles('editor', 'admin')
  @Get('chatwoot-inboxes')
  chatwootInboxes(): Promise<ChatwootInbox[]> {
    if (!this.chatwoot) throw new ServiceUnavailableException('Chatwoot is not configured');
    return this.chatwoot.listInboxes();
  }

  @Roles('editor', 'admin')
  @Get()
  list(): Promise<InboxBinding[]> {
    return this.bindings.list();
  }

  @Roles('editor', 'admin')
  @Put(':chatwootInboxId')
  upsert(
    @Param('chatwootInboxId', ParseIntPipe) chatwootInboxId: number,
    @Body(new ZodBodyPipe(bindingUpdateSchema)) body: BindingUpdate,
    @CurrentUser() user: SessionUser,
  ): Promise<InboxBinding> {
    if (chatwootInboxId <= 0) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: [{ path: 'chatwootInboxId', message: 'must be a positive integer' }],
      });
    }

    return this.bindings.upsert(chatwootInboxId, body, user.id);
  }
}
