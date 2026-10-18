import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

import { QUEUES, REDIS_DB_QUEUE } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { redisOptions } from '../infra/redis-options';
import { ALERT_JOB_NAME } from '../alerting/alerting';
import { AlertingService } from '../alerting/alerting.service';
import { RETENTION_JOB_NAME, formatRetentionSummary } from '../retention/retention';
import { RetentionService } from '../retention/retention.service';

/** Cron work is serial — neither job is a throughput path. */
const WORKER_CONCURRENCY = 1;
const WORKER_NAME = 'MaintenanceWorker';

export interface MaintenanceJobDeps {
  retention: RetentionService;
  alerting: AlertingService;
  logger: AppLogger;
}

/**
 * Transport-free handler (unit-testable) for the `maintenance` queue. One
 * worker owns every job name on the queue — splitting them across workers
 * would let BullMQ hand a job to a worker that does not understand it.
 */
export async function processMaintenanceJob(
  job: Job<unknown>,
  deps: MaintenanceJobDeps,
): Promise<void> {
  switch (job.name) {
    case RETENTION_JOB_NAME: {
      const result = await deps.retention.run();
      deps.logger.log(formatRetentionSummary(result), WORKER_NAME);
      return;
    }
    case ALERT_JOB_NAME: {
      const alerts = await deps.alerting.run();
      if (alerts.length > 0) {
        deps.logger.warn(`alert check raised ${alerts.length} alert(s)`, WORKER_NAME);
      }
      return;
    }
    default:
      // A wiring bug, not a transient failure — log it, don't retry.
      deps.logger.error(`unknown job "${job.name}" on ${QUEUES.maintenance}`, WORKER_NAME);
  }
}

/**
 * BullMQ worker for the `maintenance` queue (transport wiring only: own Redis
 * connection in queue db 0, graceful shutdown on SIGTERM). Jobs retry with the
 * ADR-0006 defaults, so a failed delivery or DB error re-runs the check.
 */
@Injectable()
export class MaintenanceWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly redisUrl: string;
  private worker?: Worker<unknown>;

  constructor(
    config: ConfigService,
    private readonly retention: RetentionService,
    private readonly alerting: AlertingService,
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
      (job) =>
        processMaintenanceJob(job, {
          retention: this.retention,
          alerting: this.alerting,
          logger: this.logger,
        }),
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
