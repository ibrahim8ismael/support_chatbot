import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import {
  USER_ROLES,
  loginInputSchema,
  type LoginInput,
  type SessionUser,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { SESSION_COOKIE_NAME } from './auth.constants';
import { CurrentUser, Public, Roles } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { getSessionCookie, sessionCookieIsSecure, sessionCookieOptions } from './session-cookie';

/** Persisted in `sessions`/`audit_logs` — cap the attacker-controlled header. */
const MAX_USER_AGENT_LENGTH = 512;

/**
 * /api/auth — session cookie flow (docs/api/rest-api.md). Login is the only
 * rate-limited, credential-accepting endpoint; login/logout are @Public so a
 * signed-out browser can always reach them.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodBodyPipe(loginInputSchema)) body: LoginInput,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: SessionUser }> {
    const { user, sessionId } = await this.auth.login(body.email, body.password, {
      ip: request.ip,
      userAgent: request.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH),
    });
    response.cookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(this.secure()));
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ status: 'ok' }> {
    await this.auth.logout(getSessionCookie(request), {
      ip: request.ip,
      userAgent: request.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH),
    });
    const cookie = sessionCookieOptions(this.secure());
    response.clearCookie(SESSION_COOKIE_NAME, { ...cookie, maxAge: undefined });
    return { status: 'ok' };
  }

  @Roles(...USER_ROLES)
  @Get('me')
  me(@CurrentUser() user: SessionUser): { user: SessionUser } {
    return { user };
  }

  private secure(): boolean {
    return sessionCookieIsSecure(this.config.get<string>('NODE_ENV'));
  }
}
