import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import type { SessionUser } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../db/database.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { CacheService } from '../infra/cache.service';
import {
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_FAILURE_WINDOW_SECONDS,
  LOGIN_IP_BLOCKED_MESSAGE,
  LOGIN_IP_LIMIT,
  LOGIN_IP_WINDOW_SECONDS,
  LOGIN_LOCKED_MESSAGE,
  SESSION_SLIDE_THRESHOLD_MS,
  SESSION_TTL_MS,
} from './auth.constants';
import type { LoginMeta, LoginResult } from './auth.types';
import { sessions } from './entities/session.entity';
import { users } from './entities/user.entity';
import { isLoginLocked, loginDelayMs, sleep } from './login-throttle';
import { PasswordService } from './password.service';

/**
 * argon2id hash of a random throwaway string — verified for unknown accounts so
 * response timing does not reveal whether an email exists.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$y0Qu8kLQxsJRonWECDk3EA$RzNHPJZGpp7CRuJeJoJrCrwW8x8PFVTAC8Du/G7ALmQ';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/**
 * Auth — owns `users` and `sessions`: argon2id login, server-side sessions,
 * per-IP + per-account login throttling (counters in Redis, fail-open when
 * Redis is down — availability first, the lock is best-effort). Every login
 * attempt and logout is audited (`audit_logs`, T-301).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cache: CacheService,
    private readonly passwords: PasswordService,
    private readonly analytics: AnalyticsService,
    private readonly logger: AppLogger,
  ) {}

  async login(email: string, password: string, meta: LoginMeta): Promise<LoginResult> {
    await this.enforceIpLimit(meta.ip, email);

    const failKey = `login:fail:${email.toLowerCase()}`;
    const failures = (await this.cache.get<number>(failKey)) ?? 0;
    if (isLoginLocked(failures)) {
      this.logger.warn(`login locked for ${email}`, AuthService.name);
      await this.analytics.recordAuditLog({
        userId: null,
        action: 'auth.login_failed',
        entity: 'session',
        data: { email, reason: 'account_locked', ip: meta.ip ?? null },
      });
      throw new HttpException(LOGIN_LOCKED_MESSAGE, 429);
    }

    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let verified = false;
    if (user) {
      verified = await this.passwords.verify(user.passwordHash, password);
    } else {
      await this.passwords.verify(DUMMY_PASSWORD_HASH, password);
    }

    if (!user || !verified || !user.isActive) {
      const next = failures + 1;
      await this.cache.set(failKey, next, LOGIN_FAILURE_WINDOW_SECONDS);
      await sleep(loginDelayMs(next));
      this.logger.warn(`failed login for ${email}`, AuthService.name);
      await this.analytics.recordAuditLog({
        userId: user?.id ?? null,
        action: 'auth.login_failed',
        entity: 'session',
        data: {
          email,
          reason: !user ? 'unknown_email' : !verified ? 'bad_password' : 'inactive_user',
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    await this.cache.del(failKey);
    const sessionId = await this.createSession(user.id, meta);
    this.logger.log(`login ok for ${email}`, AuthService.name);
    await this.analytics.recordAuditLog({
      userId: user.id,
      action: 'auth.login',
      entity: 'session',
      entityId: sessionId,
      data: { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
    });
    return { user: toSessionUser(user), sessionId };
  }

  /** Validates a cookie value and slides the expiry; `null` when signed out. */
  async resolveSession(sessionId: string | undefined): Promise<SessionUser | null> {
    if (!sessionId || !UUID_RE.test(sessionId)) {
      return null;
    }

    const [row] = await this.database.db
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!row || !row.isActive) {
      return null;
    }

    const remaining = row.expiresAt.getTime() - Date.now();
    if (remaining <= 0) {
      await this.deleteSession(row.sessionId);
      return null;
    }
    if (remaining < SESSION_TTL_MS - SESSION_SLIDE_THRESHOLD_MS) {
      await this.database.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
        .where(eq(sessions.id, row.sessionId));
    }
    return { id: row.userId, email: row.email, name: row.name, role: row.role };
  }

  /**
   * Kills the session row; idempotent, garbage cookie values are ignored.
   * The owner is read before the delete so the logout can be attributed.
   */
  async logout(sessionId: string | undefined, meta: LoginMeta = {}): Promise<void> {
    if (!sessionId || !UUID_RE.test(sessionId)) {
      return;
    }

    const [row] = await this.database.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    await this.deleteSession(sessionId);

    if (row) {
      await this.analytics.recordAuditLog({
        userId: row.userId,
        action: 'auth.logout',
        entity: 'session',
        entityId: sessionId,
        data: { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null },
      });
    }
  }

  private async createSession(userId: string, meta: LoginMeta): Promise<string> {
    const [row] = await this.database.db
      .insert(sessions)
      .values({
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
      })
      .returning({ id: sessions.id });
    if (!row) {
      throw new Error('session insert returned no row');
    }
    return row.id;
  }

  private async deleteSession(sessionId: string): Promise<void> {
    await this.database.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /**
   * Fixed-window counter per IP. Read-modify-write is racy on purpose
   * (approximate limiter); Redis errors fail open — CacheService degrades to
   * a miss, so login still works when the cache is down.
   */
  private async enforceIpLimit(ip: string | undefined, email: string): Promise<void> {
    const key = `login:ip:${ip ?? 'unknown'}`;
    const hits = (await this.cache.get<number>(key)) ?? 0;
    if (hits >= LOGIN_IP_LIMIT) {
      this.logger.warn(`login rate limited for ip ${ip ?? 'unknown'}`, AuthService.name);
      await this.analytics.recordAuditLog({
        userId: null,
        action: 'auth.login_failed',
        entity: 'session',
        data: { email, reason: 'ip_rate_limited', ip: ip ?? null },
      });
      throw new HttpException(LOGIN_IP_BLOCKED_MESSAGE, 429);
    }
    await this.cache.set(key, hits + 1, LOGIN_IP_WINDOW_SECONDS);
  }
}
