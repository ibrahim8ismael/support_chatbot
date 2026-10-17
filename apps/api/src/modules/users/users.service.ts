import { Injectable } from '@nestjs/common';

/**
 * Users — user CRUD and role management (admin only).
 * Uses the `users` table (owned by `auth` through this module's public API).
 * Does NOT do: login/session handling.
 *
 * TODO(users): CRUD endpoints per docs/api/rest-api.md (roles: admin|editor|viewer).
 */
@Injectable()
export class UsersService {}
