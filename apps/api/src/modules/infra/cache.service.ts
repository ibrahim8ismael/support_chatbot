import { Injectable } from '@nestjs/common';

import { AppLogger } from '../../common/logger/app-logger.service';
import { RedisService } from './redis.service';

/**
 * Application cache (Redis db 1). Always fail-open: errors are logged and
 * treated as misses — answers degrade to uncached, never to wrong
 * (docs/architecture/caching.md). Every key must carry a TTL.
 */
@Injectable()
export class CacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await this.redis.client.get(key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (error) {
      this.logger.warn(`cache get failed for key ${key}: ${String(error)}`, CacheService.name);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`cache set failed for key ${key}: ${String(error)}`, CacheService.name);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.client.del(key);
    } catch (error) {
      this.logger.warn(`cache del failed for key ${key}: ${String(error)}`, CacheService.name);
    }
  }
}
