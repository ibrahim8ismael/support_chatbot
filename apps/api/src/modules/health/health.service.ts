import { Injectable } from '@nestjs/common';

import type { HealthResponse } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../db/database.service';
import { QueueService } from '../infra/queue.service';
import { RedisService } from '../infra/redis.service';

const HEALTH_TIMEOUT_MS = 2000;

/** Shallow checks only — the /health contract is in docs/api/rest-api.md. */
@Injectable()
export class HealthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly logger: AppLogger,
  ) {}

  async check(): Promise<HealthResponse> {
    const [db, redis, queue] = await Promise.all([
      this.component('db', () => this.db.ping()),
      this.component('redis', () => this.redis.ping()),
      this.component('queue', () => this.queue.ping()),
    ]);

    return {
      status: db === 'ok' && redis === 'ok' && queue === 'ok' ? 'ok' : 'degraded',
      db,
      redis,
      queue,
      version: process.env.APP_VERSION ?? '0.0.0-dev',
    };
  }

  private component(name: string, check: () => Promise<unknown>): Promise<'ok' | 'error'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), HEALTH_TIMEOUT_MS);
      timer.unref();
    });

    return Promise.race([check(), timeout])
      .then(() => 'ok' as const)
      .catch((error: unknown) => {
        this.logger.warn(`health check '${name}' failed: ${String(error)}`, HealthService.name);
        return 'error' as const;
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
      });
  }
}
