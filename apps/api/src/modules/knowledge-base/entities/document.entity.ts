import type { DocumentSourceType, DocumentStatus } from '@support-agent/shared';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  (t) => [index('documents_kb_id_idx').on(t.kbId)],
);
