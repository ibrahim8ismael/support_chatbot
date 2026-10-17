import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { REDIS_DB_CACHE } from '@support-agent/shared';

import { redisOptions } from './redis-options';

/** The cache Redis connection (db 1). Queue connections are owned by BullMQ. */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(redisOptions(config.getOrThrow<string>('REDIS_URL'), REDIS_DB_CACHE));
  }

  /** Shallow liveness probe for /health. */
  async ping(): Promise<void> {
    const pong = await this.client.ping();
    if (pong !== 'PONG') {
      throw new Error(`unexpected PING response: ${pong}`);
    }
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
