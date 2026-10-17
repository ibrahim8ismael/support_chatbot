import { Injectable } from '@nestjs/common';

/**
 * Auth — owns `users` and `sessions` tables.
 * Exposes to other modules: AuthGuard, CurrentUser, RolesGuard.
 * Does NOT do: business logic of other domains.
 *
 * TODO(auth): argon2id login, server-side session rows, httpOnly cookie
 * (`support_agent_session`, sliding 7-day expiry) — D4/security doc.
 */
@Injectable()
export class AuthService {}
