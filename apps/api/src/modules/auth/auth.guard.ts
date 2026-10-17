import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { getSessionCookie } from './session-cookie';

/**
 * Session cookie → `request.user`. Registered globally (AppModule via
 * AuthModule); `@Public()` opts routes out. Everything else requires a valid,
 * unexpired session (docs/api/rest-api.md).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
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
    const user = await this.auth.resolveSession(sessionId);
    if (!user) {
      throw new UnauthorizedException('Sign in required');
    }

    request.user = user;
    request.sessionId = sessionId;
    return true;
  }
}
