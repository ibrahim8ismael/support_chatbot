import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

import { QUEUES, REDIS_DB_QUEUE } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { redisOptions } from '../infra/redis-options';
import { DIGEST_JOB_NAME, DigestService } from './digest';

/** One digest at a time; it is a weekly singleton, not a throughput path. */
const WORKER_CONCURRENCY = 1;
const WORKER_NAME = 'DigestWorker';

export interface DigestJobDeps {
  digest: DigestService;
  logger: AppLogger;
}

/**
 * Transport-free handler (unit-testable). Only digest jobs run here; unknown
 * names are a wiring bug, not a transient failure — log them, don't retry.
 */
export async function processDigestJob(job: Job<unknown>, deps: DigestJobDeps): Promise<void> {
  if (job.name !== DIGEST_JOB_NAME) {
    deps.logger.error(`unknown job "${job.name}" on ${QUEUES.analyticsFollowup}`, WORKER_NAME);
    return;
  }

  const result = await deps.digest.run();
  deps.logger.log(
    `weekly digest done: ${result.itemCount} item(s), posted=${result.posted}`,
    WORKER_NAME,
  );
}

/**
 * BullMQ worker for `analytics-followup` (transport wiring only: own Redis
 * connection in queue db 0, graceful shutdown on SIGTERM).
 */
@Injectable()
export class DigestWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly redisUrl: string;
  private worker?: Worker<unknown>;

  constructor(
    config: ConfigService,
    private readonly digest: DigestService,
    private readonly logger: AppLogger,
  ) {
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
  }

  onModuleInit(): void {
    const connection = new Redis({
      ...redisOptions(this.redisUrl, REDIS_DB_QUEUE),
      // BullMQ requirement: block indefinitely on the worker connection.
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker<unknown>(
      QUEUES.analyticsFollowup,
      (job) => processDigestJob(job, { digest: this.digest, logger: this.logger }),
      { connection, concurrency: WORKER_CONCURRENCY },
    );

    this.logger.log(
      `worker online: ${QUEUES.analyticsFollowup} (concurrency ${WORKER_CONCURRENCY})`,
      WORKER_NAME,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
