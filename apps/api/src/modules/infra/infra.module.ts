import { Module } from '@nestjs/common';

import { CacheService } from './cache.service';
import { LockService } from './lock.service';
import { QueueService } from './queue.service';
import { RedisService } from './redis.service';

/**
 * Infra — Redis, cache, distributed locks, and the BullMQ queue registry.
 * No domain logic: job business logic lives in the owning modules
 * (repo-structure.md).
 */
@Module({
  providers: [RedisService, CacheService, LockService, QueueService],
  exports: [RedisService, CacheService, LockService, QueueService],
})
export class InfraModule {}
