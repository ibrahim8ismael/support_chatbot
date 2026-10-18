import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

import {
  userCreateSchema,
  userPasswordResetSchema,
  userUpdateSchema,
  type SessionUser,
  type UserCreate,
  type UserPasswordReset,
  type UserSummary,
  type UserUpdate,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { UsersService } from './users.service';

/**
 * /api/users — user management (docs/api/rest-api.md). Admin-only per the
 * security matrix (docs/operations/security.md § 2); deactivation and
 * password resets also drop the target's sessions, and every change is
 * audited (`users.*` actions).
 */
@Controller('users')
@Roles('admin')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list(): Promise<UserSummary[]> {
    return this.usersService.list();
  }

  @Post()
  create(
    @Body(new ZodBodyPipe(userCreateSchema)) body: UserCreate,
    @CurrentUser() user: SessionUser,
  ): Promise<UserSummary> {
    return this.usersService.create(body, user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(userUpdateSchema)) body: UserUpdate,
    @CurrentUser() user: SessionUser,
  ): Promise<UserSummary> {
    return this.usersService.update(id, body, user.id);
  }

  @HttpCode(200)
  @Post(':id/password')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(userPasswordResetSchema)) body: UserPasswordReset,
    @CurrentUser() user: SessionUser,
  ): Promise<{ status: 'ok' }> {
    await this.usersService.resetPassword(id, body.password, user.id);
    return { status: 'ok' };
  }
}
