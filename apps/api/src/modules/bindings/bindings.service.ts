import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { asc, eq, sql } from 'drizzle-orm';

import type { BindingUpdate, InboxBinding } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../db/database.service';
import { CacheService } from '../infra/cache.service';
import { inboxBindings } from './entities/inbox-binding.entity';

export const BINDING_CACHE_TTL_SECONDS = 60;

/** `bind:v1:{chatwoot_inbox_id}` — docs/architecture/caching.md. */
export function bindingCacheKey(chatwootInboxId: number): string {
  return `bind:v1:${chatwootInboxId}`;
}

/**
 * Bindings — owns `inbox_bindings` (inbox ↔ KB mapping + per-inbox kill switch).
 * Exposes to other modules: `getBoundKbIdsForInbox()` (cached for the hot
 * webhook path), plus list/upsert for the admin API.
 * Does NOT do: KB CRUD itself, or Chatwoot HTTP calls (`display_name` is
 * synced by the chatwoot module when it lists inboxes).
 *
 * Empty `kbIds` or `enabled=false` both mean "bot off here" — callers only
 * need the returned array.
 */
@Injectable()
export class BindingsService {
  private readonly accountId: number;

  constructor(
    private readonly database: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: AppLogger,
    config: ConfigService,
  ) {
    const configured = config.get<number>('CHATWOOT_ACCOUNT_ID');
    // Chatwoot's default account is 1; env wins when set (deployment docs).
    this.accountId = configured ?? 1;
    if (configured === undefined) {
      this.logger.warn(
        'CHATWOOT_ACCOUNT_ID is not set — new bindings default to account 1',
        BindingsService.name,
      );
    }
  }

  /** All bindings, ordered by inbox id, with cached inbox names. */
  async list(): Promise<InboxBinding[]> {
    const rows = await this.database.db
      .select()
      .from(inboxBindings)
      .orderBy(asc(inboxBindings.chatwootInboxId));
    return rows.map((row) => toBinding(row));
  }

  /** Full-state upsert (`PUT /bindings/:chatwootInboxId`). */
  async upsert(chatwootInboxId: number, input: BindingUpdate): Promise<InboxBinding> {
    const [row] = await this.database.db
      .insert(inboxBindings)
      .values({
        chatwootAccountId: this.accountId,
        chatwootInboxId,
        kbIds: input.kbIds,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: inboxBindings.chatwootInboxId,
        // display_name is owned by the Chatwoot sync — never overwrite it here.
        set: { kbIds: input.kbIds, enabled: input.enabled, updatedAt: new Date() },
      })
      .returning();

    if (!row) {
      throw new Error(`failed to upsert binding for inbox ${chatwootInboxId}`);
    }

    await this.cache.del(bindingCacheKey(chatwootInboxId));
    return toBinding(row);
  }

  /** Filter data for the webhook/agent path: `[]` means "bot off here". */
  async getBoundKbIdsForInbox(chatwootInboxId: number): Promise<string[]> {
    const key = bindingCacheKey(chatwootInboxId);
    const cached = await this.cache.get<string[]>(key);
    if (cached) {
      // A cached empty array is a real answer ("not bound"), not a miss.
      return cached;
    }

    const [row] = await this.database.db
      .select()
      .from(inboxBindings)
      .where(eq(inboxBindings.chatwootInboxId, chatwootInboxId))
      .limit(1);

    const kbIds = row?.enabled ? row.kbIds : [];
    await this.cache.set(key, kbIds, BINDING_CACHE_TTL_SECONDS);
    return kbIds;
  }

  /** Guard for KB deletion: is this KB referenced by any inbox binding? */
  async isKbBound(kbId: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ id: inboxBindings.id })
      .from(inboxBindings)
      .where(sql`${kbId}::uuid = any(${inboxBindings.kbIds})`)
      .limit(1);
    return row !== undefined;
  }
}

function toBinding(row: typeof inboxBindings.$inferSelect): InboxBinding {
  return {
    id: row.id,
    chatwootAccountId: row.chatwootAccountId,
    chatwootInboxId: row.chatwootInboxId,
    kbIds: row.kbIds,
    enabled: row.enabled,
    displayName: row.displayName,
  };
}
