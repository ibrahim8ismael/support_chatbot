import { Module } from '@nestjs/common';

import { CacheService } from './cache.service';
import { QueueService } from './queue.service';
import { RedisService } from './redis.service';

/**
 * Infra — Redis, cache, and the BullMQ queue registry. No domain logic:
 * job business logic lives in the owning modules (repo-structure.md).
 */
@Module({
  providers: [RedisService, CacheService, QueueService],
  exports: [RedisService, CacheService, QueueService],
})
export class InfraModule {}
