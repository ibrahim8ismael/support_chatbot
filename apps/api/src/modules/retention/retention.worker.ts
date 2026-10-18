import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

import { QUEUES, REDIS_DB_QUEUE } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { redisOptions } from '../infra/redis-options';
import { RETENTION_JOB_NAME, formatRetentionSummary } from './retention';
import { RetentionService } from './retention.service';

/** One cleanup at a time — a daily singleton, not a throughput path. */
const WORKER_CONCURRENCY = 1;
const WORKER_NAME = 'RetentionWorker';

export interface RetentionJobDeps {
  retention: RetentionService;
  logger: AppLogger;
}

/**
 * Transport-free handler (unit-testable). Only retention jobs belong here;
 * unknown names are a wiring bug, not a transient failure — log, don't retry.
 */
export async function processRetentionJob(
  job: Job<unknown>,
  deps: RetentionJobDeps,
): Promise<void> {
  if (job.name !== RETENTION_JOB_NAME) {
    deps.logger.error(`unknown job "${job.name}" on ${QUEUES.maintenance}`, WORKER_NAME);
    return;
  }

  const result = await deps.retention.run();
  deps.logger.log(formatRetentionSummary(result), WORKER_NAME);
}

/**
 * BullMQ worker for the `maintenance` queue (transport wiring only: own Redis
 * connection in queue db 0, graceful shutdown on SIGTERM).
 */
@Injectable()
export class RetentionWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly redisUrl: string;
  private worker?: Worker<unknown>;

  constructor(
    config: ConfigService,
    private readonly retention: RetentionService,
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
      QUEUES.maintenance,
      (job) => processRetentionJob(job, { retention: this.retention, logger: this.logger }),
      { connection, concurrency: WORKER_CONCURRENCY },
    );

    this.logger.log(
      `worker online: ${QUEUES.maintenance} (concurrency ${WORKER_CONCURRENCY})`,
      WORKER_NAME,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
