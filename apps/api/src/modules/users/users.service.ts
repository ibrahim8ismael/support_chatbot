import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';

import type { UserCreate, UserSummary, UserUpdate } from '@support-agent/shared';

import { DatabaseService } from '../../db/database.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthService } from '../auth/auth.service';
import { sessions } from '../auth/entities/session.entity';
import { users } from '../auth/entities/user.entity';
import { PasswordService } from '../auth/password.service';

function toSummary(row: typeof users.$inferSelect): UserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Users — user CRUD and role management (admin only).
 * Uses the `users` table (owned by `auth` through this module's public API).
 * Does NOT do: login/session handling.
 *
 * Session hygiene: deactivating an account or resetting its password drops all
 * of its sessions via `AuthService.invalidateSessions` (security.md § 1).
 * Every change is audited (`audit_logs`, `users.*` actions).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly analytics: AnalyticsService,
  ) {}

  /** Oldest first — stable ordering for the admin screen. */
  async list(): Promise<UserSummary[]> {
    const rows = await this.database.db
      .select()
      .from(users)
      .orderBy(asc(users.createdAt), asc(users.email));
    return rows.map(toSummary);
  }

  async create(input: UserCreate, actorId: string): Promise<UserSummary> {
    const passwordHash = await this.passwords.hash(input.password);
    const [row] = await this.database.db
      .insert(users)
      .values({
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();

    if (!row) {
      throw new ConflictException(`a user with email ${input.email} already exists`);
    }

    await this.analytics.recordAuditLog({
      userId: actorId,
      action: 'users.create',
      entity: 'user',
      entityId: row.id,
      data: { email: row.email, name: row.name, role: row.role },
    });

    return toSummary(row);
  }

  async update(id: string, input: UserUpdate, actorId: string): Promise<UserSummary> {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) {
      patch.name = input.name;
    }
    if (input.role !== undefined) {
      patch.role = input.role;
    }
    if (input.isActive !== undefined) {
      patch.isActive = input.isActive;
    }
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('provide at least one field');
    }

    // Lockout guards (frontend audit HIGH): an admin must never remove their own
    // access, and the deployment must always keep one active admin.
    if (id === actorId) {
      if (input.role !== undefined && input.role !== 'admin') {
        throw new BadRequestException('you cannot demote your own account');
      }
      if (input.isActive === false) {
        throw new BadRequestException('you cannot deactivate your own account');
      }
    }

    const removesAdmin =
      (input.role !== undefined && input.role !== 'admin') || input.isActive === false;
    if (removesAdmin) {
      const [target] = await this.database.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!target) {
        throw new NotFoundException(`user ${id} not found`);
      }
      if (target.role === 'admin') {
        const remaining = await this.database.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, id)));
        if (remaining.length === 0) {
          throw new BadRequestException('at least one active admin must remain');
        }
      }
    }

    const [row] = await this.database.db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException(`user ${id} not found`);
    }

    // Session hygiene: a deactivated account loses every session immediately.
    if (input.isActive === false) {
      await this.auth.invalidateSessions(id);
    }

    await this.analytics.recordAuditLog({
      userId: actorId,
      action: 'users.update',
      entity: 'user',
      entityId: id,
      data: { email: row.email, patch },
    });

    return toSummary(row);
  }

  /**
   * Admin reset — hashes, replaces and drops sessions in ONE transaction so a
   * crash can never leave sessions issued with the old password alive.
   */
  async resetPassword(id: string, password: string, actorId: string): Promise<void> {
    const passwordHash = await this.passwords.hash(password);
    const row = await this.database.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, id))
        .returning({ id: users.id, email: users.email });

      if (!updated) {
        return null;
      }

      await tx.delete(sessions).where(eq(sessions.userId, id));
      return updated;
    });

    if (!row) {
      throw new NotFoundException(`user ${id} not found`);
    }

    await this.analytics.recordAuditLog({
      userId: actorId,
      action: 'users.password_reset',
      entity: 'user',
      entityId: id,
      data: { email: row.email },
    });
  }
}
