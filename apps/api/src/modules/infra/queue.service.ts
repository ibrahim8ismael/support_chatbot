import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { QUEUES, REDIS_DB_QUEUE, type QueueName } from '@support-agent/shared';

import { redisOptions } from './redis-options';

/**
 * BullMQ queues (ADR-0006). Reliability defaults match the ADR: 3 attempts with
 * exponential backoff, failed jobs retained for inspection.
 *
 * Each queue owns its own Redis connection (BullMQ 6 takes a client instance);
 * workers get their own blocking connections when they land.
 *
 * TODO(infra): worker registrations live with the owning modules' job handlers
 * (ingestion, agent, analytics) — see the module table in repo-structure.md.
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('REDIS_URL');

    for (const name of Object.values(QUEUES)) {
      const connection = new Redis({
        ...redisOptions(url, REDIS_DB_QUEUE),
        // BullMQ requirement: block indefinitely on the queue connection.
        maxRetriesPerRequest: null,
      });

      this.queues.set(
        name,
        new Queue(name, {
          connection,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnFail: false,
          },
        }),
      );
    }
  }

  queue(name: QueueName): Queue {
    const queue = this.queues.get(name);
    if (!queue) {
      throw new Error(`Unknown queue: ${name}`);
    }
    return queue;
  }

  /**
   * Enqueue a job. Callers pass a deterministic jobId when coalescing is wanted
   * (e.g. `reply:<conversation_id>` — ADR-0006 per-conversation serialization).
   */
  async enqueue<Data>(
    name: QueueName,
    jobName: string,
    data: Data,
    opts?: { jobId?: string },
  ): Promise<string | undefined> {
    const job = await this.queue(name).add(jobName, data, opts);
    return job.id;
  }

  /** Shallow liveness probe for /health. */
  async ping(): Promise<void> {
    await this.queue(QUEUES.reply).getJobCounts('waiting');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
