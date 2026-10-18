import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import type { UserCreate, UserSummary, UserUpdate } from '@support-agent/shared';

import { DatabaseService } from '../../db/database.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AuthService } from '../auth/auth.service';
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

  /** Admin reset — hashes, replaces, kills sessions, audits. */
  async resetPassword(id: string, password: string, actorId: string): Promise<void> {
    const passwordHash = await this.passwords.hash(password);
    const [row] = await this.database.db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email });

    if (!row) {
      throw new NotFoundException(`user ${id} not found`);
    }

    // Session hygiene: any session issued with the old password dies here.
    await this.auth.invalidateSessions(id);
    await this.analytics.recordAuditLog({
      userId: actorId,
      action: 'users.password_reset',
      entity: 'user',
      entityId: id,
      data: { email: row.email },
    });
  }
}
