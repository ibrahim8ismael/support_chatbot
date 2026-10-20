import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

import { QUEUES, REDIS_DB_QUEUE, type SandboxRunJob } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { redisOptions } from '../infra/redis-options';
import { SandboxService } from './sandbox.service';

const WORKER_NAME = 'SandboxRunWorker';

export interface SandboxJobDeps {
  sandbox: SandboxService;
  logger: AppLogger;
}

/**
 * Job handler kept transport-free so the retry/failure rules are unit-testable
 * (same pattern as `ingest-document.worker.ts`). Per-case failures are recorded
 * on the result row; only an infrastructure failure reaches this layer.
 */
export async function processSandboxRunJob(
  job: Job<SandboxRunJob>,
  deps: SandboxJobDeps,
): Promise<void> {
  const { runId } = job.data;

  try {
    await deps.sandbox.processRun(runId);
    deps.logger.log(`sandbox-run ${runId} processed`, WORKER_NAME);
  } catch (error) {
    const message = readableError(error);
    const attempts = job.opts.attempts ?? 1;
    const finalAttempt = job.attemptsMade + 1 >= attempts;

    if (finalAttempt) {
      deps.logger.error(
        `sandbox-run ${runId} failed after ${attempts} attempt(s): ${message}`,
        WORKER_NAME,
      );
      try {
        await deps.sandbox.markRunFailed(runId, message);
      } catch (markError) {
        deps.logger.error(
          `could not mark sandbox run ${runId} as failed: ${String(markError)}`,
          WORKER_NAME,
        );
      }
    } else {
      deps.logger.warn(
        `sandbox-run ${runId} attempt ${job.attemptsMade + 1} failed — retrying: ${message}`,
        WORKER_NAME,
      );
    }
    throw error;
  }
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

/**
 * BullMQ worker for `sandbox-run`. Concurrency is fixed at one: a batch already
 * fans out per case, and two runs at once would double the provider bill for no
 * product benefit.
 */
@Injectable()
export class SandboxRunWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly redisUrl: string;
  private worker?: Worker<SandboxRunJob>;

  constructor(
    config: ConfigService,
    private readonly sandbox: SandboxService,
    private readonly logger: AppLogger,
  ) {
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
  }

  onModuleInit(): void {
    const connection = new Redis({
      ...redisOptions(this.redisUrl, REDIS_DB_QUEUE),
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker<SandboxRunJob>(
      QUEUES.sandbox,
      (job) => processSandboxRunJob(job, { sandbox: this.sandbox, logger: this.logger }),
      { connection, concurrency: 1 },
    );

    this.logger.log(`worker online: ${QUEUES.sandbox} (concurrency 1)`, WORKER_NAME);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
