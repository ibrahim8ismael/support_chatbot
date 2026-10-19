import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';

import { kbVersionKey } from '@support-agent/shared';

import { withRetries } from '../../common/async/retry';
import { AppLogger } from '../../common/logger/app-logger.service';
import { resolveUploadPath } from '../../common/storage/uploads';
import { DatabaseService } from '../../db/database.service';
import { CacheService } from '../infra/cache.service';
import {
  KnowledgeBaseService,
  type IngestionDocument,
} from '../knowledge-base/knowledge-base.service';
import { LlmService } from '../llm/llm.service';
import { chunkBlocks, type ChunkDraft } from './chunking';
import { cleanBlocks } from './cleaning';
import { chunks } from './entities/chunk.entity';
import { parseDocument } from './parsers';

/** Provider batch limit; also keeps retry units small (pipeline doc step 5). */
export const EMBED_BATCH_SIZE = 100;
/** Rows per INSERT — each carries a 1536-float embedding. */
const CHUNK_INSERT_BATCH = 50;

/**
 * Resource guards (audit HIGH): a crafted document must not exhaust the API
 * process. Extracted text is capped before chunking and chunks before
 * embedding, so pathological inputs fail fast and visibly.
 */
export const MAX_EXTRACTED_TEXT_CHARS = 2_000_000;
export const MAX_CHUNKS_PER_DOCUMENT = 2000;

/**
 * Ingestion — owns `chunks`. The `ingest-document` worker calls `ingest()`:
 * parse → clean → chunk → embed → replace chunks. Idempotent by design
 * (BullMQ delivers at least once): a document that is already `ready` with
 * chunks is skipped, and every run replaces the chunk set transactionally —
 * it never appends.
 */
@Injectable()
export class IngestionService {
  private readonly uploadDir: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly knowledgeBase: KnowledgeBaseService,
    private readonly llm: LlmService,
    private readonly cache: CacheService,
    private readonly logger: AppLogger,
    config: ConfigService,
  ) {
    this.uploadDir = path.resolve(config.get<string>('UPLOAD_DIR') ?? './data/uploads');
  }

  async ingest(documentId: string): Promise<'skipped' | 'ingested'> {
    const document = await this.knowledgeBase.getIngestionDocument(documentId);
    if (!document) {
      this.logger.warn(
        `document ${documentId} no longer exists — nothing to ingest`,
        IngestionService.name,
      );
      return 'skipped';
    }

    if (document.status === 'ready' && document.chunkCount > 0) {
      this.logger.log(
        `document ${documentId} already ingested (content ${document.contentHash.slice(0, 12)}…) — skipping`,
        IngestionService.name,
      );
      return 'skipped';
    }

    if (!document.storagePath) {
      throw new Error(
        `document ${documentId} has no stored file (source_type=${document.sourceType})`,
      );
    }

    const buffer = await readFile(resolveUploadPath(this.uploadDir, document.storagePath));
    const blocks = cleanBlocks(await parseDocument(buffer, document.mimeType));
    const extractedChars = blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (extractedChars > MAX_EXTRACTED_TEXT_CHARS) {
      throw new Error(
        `document extracts ${extractedChars} characters — the limit is ${MAX_EXTRACTED_TEXT_CHARS}`,
      );
    }
    const drafts = chunkBlocks(blocks);
    if (drafts.length === 0) {
      throw new Error('no extractable text found in the document');
    }
    if (drafts.length > MAX_CHUNKS_PER_DOCUMENT) {
      throw new Error(
        `document produces ${drafts.length} chunks — the limit is ${MAX_CHUNKS_PER_DOCUMENT}`,
      );
    }

    const vectors = await this.embedInBatches(drafts.map((draft) => draft.content));
    await this.replaceChunks(document, drafts, vectors);
    await this.knowledgeBase.markDocumentReady(document.id, drafts.length);
    await this.cache.incr(kbVersionKey(document.kbId));

    this.logger.log(
      `document ${documentId} ingested: ${drafts.length} chunk(s), ${vectors.length} vector(s)`,
      IngestionService.name,
    );
    return 'ingested';
  }

  /** Batches of 100 with 3 attempts + exponential backoff (pipeline doc). */
  private async embedInBatches(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + EMBED_BATCH_SIZE);
      const { embeddings } = await withRetries(() => this.llm.embed(batch), {
        onRetry: (error, attempt) =>
          this.logger.warn(
            `embedding batch (${batch.length} texts) failed on attempt ${attempt}: ${String(error)} — retrying`,
            IngestionService.name,
          ),
      });

      if (embeddings.length !== batch.length) {
        throw new Error(
          `embedding provider returned ${embeddings.length} vectors for ${batch.length} texts`,
        );
      }
      vectors.push(...embeddings);
    }

    return vectors;
  }

  /** Transactional replace; the advisory lock serializes duplicate deliveries. */
  private async replaceChunks(
    document: IngestionDocument,
    drafts: ChunkDraft[],
    vectors: number[][],
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ingest:${document.id}`}))`);
      await tx.delete(chunks).where(eq(chunks.documentId, document.id));

      const rows = drafts.map((draft, index) => {
        const embedding = vectors[index];
        if (!embedding) {
          throw new Error(`missing embedding for chunk ${index} of document ${document.id}`);
        }
        return {
          kbId: document.kbId,
          documentId: document.id,
          chunkIndex: index,
          content: draft.content,
          tokenCount: draft.tokenCount,
          metadata: draft.metadata,
          embedding,
        };
      });

      for (let offset = 0; offset < rows.length; offset += CHUNK_INSERT_BATCH) {
        await tx.insert(chunks).values(rows.slice(offset, offset + CHUNK_INSERT_BATCH));
      }
    });
  }
}
