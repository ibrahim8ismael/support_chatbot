import type { DocumentSourceType, DocumentStatus } from '@support-agent/shared';
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../auth/entities/user.entity';
import { knowledgeBases } from './knowledge-base.entity';

/** `documents` — one uploaded/pasted/URL source; hard-deletes cascade chunks. */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbId: uuid('kb_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').$type<DocumentSourceType>().notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storagePath: text('storage_path'),
    status: text('status').$type<DocumentStatus>().notNull().default('processing'),
    error: text('error'),
    chunkCount: integer('chunk_count').notNull().default(0),
    /** sha256 of raw content — skip re-embedding when unchanged. */
    contentHash: text('content_hash').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('documents_kb_id_idx').on(t.kbId),
    // One live copy per (kb, content): the service's pre-check races under
    // concurrent uploads, so the partial unique index is the real guard
    // (a `failed` row is not a live copy and may be retried) — audit P2.
    uniqueIndex('documents_kb_content_hash_unique')
      .on(t.kbId, t.contentHash)
      .where(sql`status <> 'failed'`),
  ],
);
