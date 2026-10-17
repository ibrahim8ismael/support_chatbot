import { index, integer, jsonb, pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';

import { EMBEDDING_DIMENSIONS } from '@support-agent/shared';

import { documents } from '../../knowledge-base/entities/document.entity';
import { knowledgeBases } from '../../knowledge-base/entities/knowledge-base.entity';

/** Dimensions come from shared constants — locked by D3 and the migration. */

export interface ChunkMetadata {
  heading?: string;
  page?: number;
  source_url?: string;
}

/**
 * `chunks` — `ingestion` writes, `retrieval` reads. `kb_id` is denormalized
 * for filtered search (no join per query).
 */
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbId: uuid('kb_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    metadata: jsonb('metadata').$type<ChunkMetadata>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chunks_kb_id_idx').on(t.kbId),
    // pgvector defaults are m = 16, ef_construction = 64 (data-model.md).
    index('chunks_embedding_hnsw').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);
