import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { settingsSchema, type Settings, type SettingsPatch } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../db/database.service';
import { CacheService } from '../infra/cache.service';
import { settings } from './entities/setting.entity';
import { buildSettingsDefaults } from './settings.defaults';

export const SETTINGS_CACHE_KEY = 'settings:v1';
const SETTINGS_CACHE_TTL_SECONDS = 60;

/**
 * Settings — owns the `settings` key/value table (typed accessors, values
 * validated on write; cached 60 s with explicit invalidation).
 * Exposes to other modules: typed get/getValue/update of runtime settings.
 * Does NOT do: secrets — those are env-only (docs/operations/security.md).
 *
 * Only overridden keys have rows; reads merge them over defaults, so adding a
 * key never needs a data migration. Rows that are unknown or fail validation
 * (manual DB edits) fall back to defaults with a warning — settings must never
 * break the reply path.
 */
@Injectable()
export class SettingsService {
  private readonly defaults: Settings;

  constructor(
    private readonly database: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: AppLogger,
    config: ConfigService,
  ) {
    this.defaults = buildSettingsDefaults(config);
  }

  /** Full typed snapshot (Redis-cached for 60 s, busted on every write). */
  async get(): Promise<Settings> {
    const cached = await this.cache.get<Settings>(SETTINGS_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const rows = await this.database.db.select().from(settings);
    const merged = this.mergeRows(rows);
    await this.cache.set(SETTINGS_CACHE_KEY, merged, SETTINGS_CACHE_TTL_SECONDS);
    return merged;
  }

  /** Typed accessor for callers that need one key (e.g. `bot_enabled`). */
  async getValue<K extends keyof Settings>(key: K): Promise<Settings[K]> {
    const current = await this.get();
    return current[key];
  }

  /** Validated partial update (schema enforced at the API edge). */
  async update(patch: SettingsPatch): Promise<Settings> {
    const entries = Object.entries(patch);
    if (entries.length === 0) {
      return this.get();
    }

    await this.database.db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await tx
          .insert(settings)
          .values({ key, value })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value, updatedAt: new Date() },
          });
      }
    });

    await this.cache.del(SETTINGS_CACHE_KEY);
    return this.get();
  }

  private mergeRows(rows: Array<typeof settings.$inferSelect>): Settings {
    const merged: Settings = { ...this.defaults };

    for (const row of rows) {
      const key = row.key;
      if (!Object.hasOwn(settingsSchema.shape, key)) {
        this.logger.warn(`ignoring unknown settings key "${key}"`, SettingsService.name);
        continue;
      }

      const typedKey = key as keyof Settings;
      const parsed = settingsSchema.shape[typedKey].safeParse(row.value);
      if (!parsed.success) {
        this.logger.warn(
          `invalid stored value for settings key "${typedKey}" — falling back to default`,
          SettingsService.name,
        );
        continue;
      }

      (merged as Record<string, unknown>)[typedKey] = parsed.data;
    }

    return merged;
  }
}
