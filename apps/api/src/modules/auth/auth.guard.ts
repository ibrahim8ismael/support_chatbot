import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';

import { IS_PUBLIC_KEY } from './auth.decorators';
import { SESSION_COOKIE_NAME } from './auth.constants';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { getSessionCookie, sessionCookieIsSecure, sessionCookieOptions } from './session-cookie';

/**
 * Session cookie → `request.user`. Registered globally (AppModule via
 * AuthModule); `@Public()` opts routes out. Everything else requires a valid,
 * unexpired session (docs/api/rest-api.md). When the session row slides, the
 * cookie is re-issued with a fresh max-age so the two lifetimes stay in step
 * (audit P2).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = getSessionCookie(request);
    const resolved = await this.auth.resolveSession(sessionId);
    if (!resolved) {
      throw new UnauthorizedException('Sign in required');
    }

    if (resolved.slid && sessionId) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .cookie(
          SESSION_COOKIE_NAME,
          sessionId,
          sessionCookieOptions(sessionCookieIsSecure(this.config.get<string>('NODE_ENV'))),
        );
    }

    request.user = resolved.user;
    request.sessionId = sessionId;
    return true;
  }
}
