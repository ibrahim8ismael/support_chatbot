import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { DatabaseService } from '../../db/database.service';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { CacheService } from '../infra/cache.service';
import { BindingsService, BINDING_CACHE_TTL_SECONDS, bindingCacheKey } from './bindings.service';
import { inboxBindings } from './entities/inbox-binding.entity';

const KB_A = '11111111-1111-4111-8111-111111111111';
const KB_B = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

interface BindingRow {
  id: string;
  chatwootAccountId: number;
  chatwootInboxId: number;
  kbIds: string[];
  enabled: boolean;
  displayName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function row(overrides: Partial<BindingRow> = {}): BindingRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    chatwootAccountId: 1,
    chatwootInboxId: 3,
    kbIds: [KB_A, KB_B],
    enabled: true,
    displayName: 'Website',
    createdAt: new Date('2026-10-18T10:00:00Z'),
    updatedAt: new Date('2026-10-18T10:00:00Z'),
    ...overrides,
  };
}

function buildHarness(rows: BindingRow[] = [], options: { accountId?: number } = {}) {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => rows.slice(0, 1)),
      })),
      orderBy: vi.fn(async () => rows),
    })),
  }));

  const insertedValues: unknown[] = [];
  const conflictConfigs: unknown[] = [];
  const insert = vi.fn(() => ({
    values: (values: Omit<BindingRow, 'id' | 'displayName' | 'createdAt' | 'updatedAt'>) => {
      insertedValues.push(values);
      return {
        onConflictDoUpdate: (config: unknown) => {
          conflictConfigs.push(config);
          return {
            returning: vi.fn(async () => [
              row({ ...values, displayName: values.chatwootInboxId === 3 ? 'Website' : null }),
            ]),
          };
        },
      };
    },
  }));

  const database = { db: { select, insert } } as unknown as DatabaseService;

  const store = new Map<string, unknown>();
  const cache = {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  } as unknown as CacheService;

  const logger = { warn: vi.fn() } as unknown as AppLogger;
  const config = { get: vi.fn(() => options.accountId) } as unknown as ConfigService;

  const recordAuditLog = vi.fn(async (_input: unknown) => undefined);
  const analytics = { recordAuditLog } as unknown as AnalyticsService;

  return {
    service: new BindingsService(database, cache, analytics, logger, config),
    select,
    insert,
    insertedValues,
    conflictConfigs,
    cache,
    store,
    logger,
    recordAuditLog,
  };
}

describe('BindingsService', () => {
  it('lists bindings ordered by inbox id with cached display names', async () => {
    const { service } = buildHarness([
      row({ chatwootInboxId: 5, displayName: null }),
      row({ chatwootInboxId: 3, displayName: 'Website' }),
    ]);

    const bindings = await service.list();

    expect(bindings).toHaveLength(2);
    expect(bindings[0]).toMatchObject({
      chatwootInboxId: 5,
      kbIds: [KB_A, KB_B],
      enabled: true,
      displayName: null,
    });
    expect(bindings[1]?.displayName).toBe('Website');
  });

  it('upserts the full state and never touches the cached display name', async () => {
    const { service, insertedValues, conflictConfigs, cache, recordAuditLog } = buildHarness([], {
      accountId: 7,
    });

    const binding = await service.upsert(9, { kbIds: [KB_A], enabled: false }, ACTOR_ID);

    expect(insertedValues).toEqual([
      { chatwootAccountId: 7, chatwootInboxId: 9, kbIds: [KB_A], enabled: false },
    ]);
    expect(conflictConfigs[0]).toMatchObject({
      target: inboxBindings.chatwootInboxId,
      set: { kbIds: [KB_A], enabled: false, updatedAt: expect.any(Date) },
    });
    expect(conflictConfigs[0]).not.toHaveProperty('set.displayName');
    expect(cache.del).toHaveBeenCalledWith(bindingCacheKey(9));
    expect(binding).toMatchObject({ chatwootInboxId: 9, kbIds: [KB_A], enabled: false });
    expect(recordAuditLog).toHaveBeenCalledWith({
      userId: ACTOR_ID,
      action: 'binding.update',
      entity: 'inbox_binding',
      entityId: '9',
      data: { kbIds: [KB_A], enabled: false },
    });
  });

  it('defaults to Chatwoot account 1 with a warning when env is missing', async () => {
    const { service, insertedValues, logger } = buildHarness();

    await service.upsert(3, { kbIds: [], enabled: true }, ACTOR_ID);

    expect(insertedValues[0]).toMatchObject({ chatwootAccountId: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('CHATWOOT_ACCOUNT_ID'),
      'BindingsService',
    );
  });

  it('returns bound kb ids for an enabled inbox and caches them for 60 s', async () => {
    const { service, cache, select } = buildHarness([row()]);

    const first = await service.getBoundKbIdsForInbox(3);
    const second = await service.getBoundKbIdsForInbox(3);

    expect(first).toEqual([KB_A, KB_B]);
    expect(second).toEqual(first);
    expect(select).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      bindingCacheKey(3),
      [KB_A, KB_B],
      BINDING_CACHE_TTL_SECONDS,
    );
  });

  it('returns an empty list for a disabled inbox (kill switch)', async () => {
    const { service } = buildHarness([row({ enabled: false })]);

    await expect(service.getBoundKbIdsForInbox(3)).resolves.toEqual([]);
  });

  it('caches the empty result for unbound inboxes', async () => {
    const { service, cache, select } = buildHarness([]);

    const first = await service.getBoundKbIdsForInbox(42);
    const second = await service.getBoundKbIdsForInbox(42);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(cache.set).toHaveBeenCalledWith(bindingCacheKey(42), [], BINDING_CACHE_TTL_SECONDS);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
