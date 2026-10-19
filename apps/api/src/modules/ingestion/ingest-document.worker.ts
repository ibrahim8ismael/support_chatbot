import { Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

import { QUEUES, REDIS_DB_QUEUE, type IngestDocumentJob } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { redisOptions } from '../infra/redis-options';
import { KnowledgeBaseService } from '../knowledge-base/knowledge-base.service';
import { IngestionService } from './ingestion.service';

/** Parsing is CPU-heavy, embeddings are I/O — default 2 keeps the API host responsive. */
const DEFAULT_WORKER_CONCURRENCY = 2;
const WORKER_NAME = 'IngestDocumentWorker';

export interface IngestJobDeps {
  ingestion: IngestionService;
  knowledgeBase: KnowledgeBaseService;
  logger: AppLogger;
}

/**
 * Job handler kept transport-free so it is unit-testable. Failure semantics
 * (ADR-0006): BullMQ retries with backoff; on the *final* attempt the document
 * is marked `failed` with a readable error, earlier attempts leave it
 * `processing` for the next run.
 */
export async function processIngestDocumentJob(
  job: Job<IngestDocumentJob>,
  deps: IngestJobDeps,
): Promise<void> {
  const { documentId } = job.data;

  try {
    const outcome = await deps.ingestion.ingest(documentId);
    deps.logger.log(
      `ingest-document ${documentId}: ${outcome} (attempt ${job.attemptsMade + 1})`,
      WORKER_NAME,
    );
  } catch (error) {
    const message = readableError(error);
    const attempts = job.opts.attempts ?? 1;
    const finalAttempt = job.attemptsMade + 1 >= attempts;

    if (finalAttempt) {
      deps.logger.error(
        `ingest-document ${documentId} failed after ${attempts} attempt(s): ${message}`,
        WORKER_NAME,
      );
      try {
        await deps.knowledgeBase.markDocumentFailed(documentId, message);
      } catch (markError) {
        deps.logger.error(
          `could not mark document ${documentId} as failed: ${String(markError)}`,
          WORKER_NAME,
        );
      }
    } else {
      deps.logger.warn(
        `ingest-document ${documentId} attempt ${job.attemptsMade + 1} failed — retrying: ${message}`,
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
 * BullMQ worker for `ingest-document` (the class is only transport wiring:
 * one Redis connection in queue db 0, graceful shutdown on SIGTERM).
 */
@Injectable()
export class IngestDocumentWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly redisUrl: string;
  private readonly concurrency: number;
  private worker?: Worker<IngestDocumentJob>;

  constructor(
    config: ConfigService,
    private readonly ingestion: IngestionService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly logger: AppLogger,
  ) {
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
    // The one knob operators tune for queue backlog (deployment.md env table).
    this.concurrency = config.get<number>('WORKER_CONCURRENCY') ?? DEFAULT_WORKER_CONCURRENCY;
  }

  onModuleInit(): void {
    const connection = new Redis({
      ...redisOptions(this.redisUrl, REDIS_DB_QUEUE),
      // BullMQ requirement: block indefinitely on the worker connection.
      maxRetriesPerRequest: null,
    });

    this.worker = new Worker<IngestDocumentJob>(
      QUEUES.ingestDocument,
      (job) =>
        processIngestDocumentJob(job, {
          ingestion: this.ingestion,
          knowledgeBase: this.knowledgeBase,
          logger: this.logger,
        }),
      { connection, concurrency: this.concurrency },
    );

    this.logger.log(
      `worker online: ${QUEUES.ingestDocument} (concurrency ${this.concurrency})`,
      WORKER_NAME,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }
}
