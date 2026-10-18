import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';

import {
  bindingUpdateSchema,
  type BindingUpdate,
  type InboxBinding,
  type SessionUser,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { BindingsService } from './bindings.service';

/**
 * /api/bindings — inbox ↔ KB mapping (docs/api/rest-api.md). Editors manage
 * bindings per the security matrix (docs/operations/security.md § 2).
 * Live Chatwoot inbox discovery (`GET /bindings/chatwoot-inboxes`) lands with
 * the Chatwoot client (T-003) — this module never talks to Chatwoot itself.
 */
@Controller('bindings')
export class BindingsController {
  constructor(private readonly bindings: BindingsService) {}

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
