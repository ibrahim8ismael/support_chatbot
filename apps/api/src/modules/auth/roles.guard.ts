import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { UserRole } from '@support-agent/shared';

import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.types';

/**
 * Role capability check. Default is admin: endpoints must opt into lower
 * roles explicitly with `@Roles(...)` (docs/operations/security.md § 2).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? ['admin'];

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(`Requires role: ${required.join(' | ')}`);
    }
    return true;
  }
}
