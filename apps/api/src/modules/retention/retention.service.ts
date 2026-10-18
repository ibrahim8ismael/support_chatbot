import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { DatabaseService } from '../../db/database.service';
import {
  RETENTION_BATCH_SIZE,
  RETENTION_DAYS_DEFAULT,
  RETENTION_TARGETS,
  retentionCutoff,
  runRetention,
  type RetentionResult,
  type RetentionTable,
  type RetentionTarget,
} from './retention';

/**
 * One DELETE keeps a short row lock: candidate ids are picked in a limited
 * subquery and deleted by primary key, so a large backlog never becomes one
 * table-wide transaction. `RETURNING id` gives the batch count back.
 */
export function targetAdapter(db: PostgresJsDatabase, target: RetentionTarget): RetentionTable {
  return {
    name: target.name,
    deleteBatch: async (cutoff, limit) => {
      // Bind an ISO string (postgres.js cannot serialize a raw Date through
      // drizzle's prepared-execute path) and pin the parameter type.
      const deleted = await db.execute(sql`
        delete from ${sql.identifier(target.name)}
        where id in (
          select id from ${sql.identifier(target.name)}
          where ${sql.raw(target.ageColumn)} < ${cutoff.toISOString()}::timestamptz
          limit ${limit}
        )
        returning id
      `);
      return deleted.length;
    },
  };
}

/**
 * Retention cleanup (T-403, NFR-7): delete messages/conversations and
 * analytics/audit events older than `RETENTION_DAYS` (default 12 months).
 * Documents, chunks and KBs are never touched. Invoked by `RetentionWorker`
 * on the daily `retention-cleanup` job; safe to run manually (idempotent).
 */
@Injectable()
export class RetentionService {
  private readonly retentionDays: number;

  constructor(
    config: ConfigService,
    private readonly database: DatabaseService,
  ) {
    this.retentionDays = config.get<number>('RETENTION_DAYS') ?? RETENTION_DAYS_DEFAULT;
  }

  /** Delete everything older than `now − RETENTION_DAYS` in FK-safe batches. */
  async run(now: Date = new Date()): Promise<RetentionResult> {
    const cutoff = retentionCutoff(now, this.retentionDays);
    const tables = RETENTION_TARGETS.map((target) => targetAdapter(this.database.db, target));
    return runRetention(tables, cutoff, RETENTION_BATCH_SIZE);
  }
}
