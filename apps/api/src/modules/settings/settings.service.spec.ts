import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { DatabaseService } from '../../db/database.service';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { CacheService } from '../infra/cache.service';
import { settings } from './entities/setting.entity';
import { SETTINGS_CACHE_KEY, SettingsService } from './settings.service';

const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: Date;
}

function buildHarness(initialRows: SettingRow[] = []) {
  const rows = [...initialRows];

  const selectFrom = vi.fn(async () => rows);
  const select = vi.fn(() => ({ from: selectFrom }));

  const inserted: Array<{ key: string; value: unknown }> = [];
  const conflictConfigs: unknown[] = [];
  const txInsert = vi.fn(() => ({
    values: (entry: { key: string; value: unknown }) => {
      inserted.push(entry);
      return {
        onConflictDoUpdate: async (config: unknown) => {
          conflictConfigs.push(config);
          const index = rows.findIndex((row) => row.key === entry.key);
          const next = { ...entry, updatedAt: new Date() };
          if (index === -1) {
            rows.push(next);
          } else {
            rows[index] = next;
          }
        },
      };
    },
  }));
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
    callback({ insert: txInsert }),
  );

  const database = {
    db: { select, transaction },
  } as unknown as DatabaseService;

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

  const recordAuditLog = vi.fn(async (_input: unknown) => undefined);
  const analytics = { recordAuditLog } as unknown as AnalyticsService;

  const env: Record<string, string> = {
    EMBEDDING_MODEL: 'text-embedding-3-small',
    CHAT_MODEL: 'gpt-4.1-mini',
  };
  const config = {
    get: vi.fn((key: string) => env[key]),
  } as unknown as ConfigService;

  return {
    service: new SettingsService(database, cache, analytics, logger, config),
    rows,
    selectFrom,
    inserted,
    conflictConfigs,
    cache,
    logger,
    recordAuditLog,
  };
}

describe('SettingsService', () => {
  it('returns documented defaults when the table is empty', async () => {
    const { service } = buildHarness();

    const snapshot = await service.get();

    expect(snapshot).toMatchObject({
      bot_enabled: false,
      retrieval_top_k: 10,
      retrieval_score_threshold: 0.35,
      context_chunks: 5,
      max_reply_chars: 800,
      embedding_model: 'text-embedding-3-small',
      chat_model: 'gpt-4.1-mini',
    });
    expect(snapshot.system_prompt).toContain('[GROUNDING RULES]');
    expect(snapshot.system_prompt).toContain('{{max_reply_chars}}');
    expect(snapshot.fallback_message).toContain('human colleague');
  });

  it('merges stored overrides over defaults', async () => {
    const { service } = buildHarness([
      { key: 'bot_enabled', value: true, updatedAt: new Date() },
      { key: 'retrieval_top_k', value: 7, updatedAt: new Date() },
    ]);

    const snapshot = await service.get();

    expect(snapshot.bot_enabled).toBe(true);
    expect(snapshot.retrieval_top_k).toBe(7);
    expect(snapshot.context_chunks).toBe(5);
  });

  it('ignores unknown or invalid stored rows and warns', async () => {
    const { service, logger } = buildHarness([
      { key: 'retired_key', value: 'x', updatedAt: new Date() },
      { key: 'context_chunks', value: 'many', updatedAt: new Date() },
    ]);

    const snapshot = await service.get();

    expect(snapshot.context_chunks).toBe(5);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('serves repeat reads from the 60 s cache', async () => {
    const { service, selectFrom, cache } = buildHarness();

    const first = await service.get();
    const second = await service.get();

    expect(selectFrom).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(SETTINGS_CACHE_KEY, first, 60);
    expect(second).toEqual(first);
  });

  it('upserts every patched key in one transaction and busts the cache', async () => {
    const { service, inserted, conflictConfigs, cache } = buildHarness();

    const snapshot = await service.update({ bot_enabled: true, retrieval_top_k: 7 }, ACTOR_ID);

    expect(inserted).toEqual([
      { key: 'bot_enabled', value: true },
      { key: 'retrieval_top_k', value: 7 },
    ]);
    expect(conflictConfigs).toHaveLength(2);
    expect(conflictConfigs[0]).toMatchObject({
      target: settings.key,
      set: { value: true, updatedAt: expect.any(Date) },
    });
    expect(cache.del).toHaveBeenCalledWith(SETTINGS_CACHE_KEY);
    expect(snapshot.bot_enabled).toBe(true);
    expect(snapshot.retrieval_top_k).toBe(7);
  });

  it('audits the change with a before/after diff per key', async () => {
    const { service, recordAuditLog } = buildHarness();

    await service.update({ bot_enabled: true, retrieval_top_k: 7 }, ACTOR_ID);

    expect(recordAuditLog).toHaveBeenCalledWith({
      userId: ACTOR_ID,
      action: 'setting.update',
      entity: 'settings',
      data: {
        changes: {
          bot_enabled: { from: false, to: true },
          retrieval_top_k: { from: 10, to: 7 },
        },
      },
    });
  });

  it('does not audit an empty patch (no-op)', async () => {
    const { service, recordAuditLog } = buildHarness();

    await service.update({}, ACTOR_ID);

    expect(recordAuditLog).not.toHaveBeenCalled();
  });

  it('exposes single-key typed access', async () => {
    const { service } = buildHarness([{ key: 'bot_enabled', value: true, updatedAt: new Date() }]);

    await expect(service.getValue('bot_enabled')).resolves.toBe(true);
  });
});
