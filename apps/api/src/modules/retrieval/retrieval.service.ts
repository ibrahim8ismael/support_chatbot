import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  kbVersionKey,
  type RetrievedChunk,
  type RetrievedChunkMetadata,
  type RetrievalResult,
  type RetrievalTrace,
} from '@support-agent/shared';

import { DatabaseService } from '../../db/database.service';
import { chunks } from '../ingestion/entities/chunk.entity';
import { CacheService } from '../infra/cache.service';
import { documents } from '../knowledge-base/entities/document.entity';
import { LlmService } from '../llm/llm.service';
import { SettingsService } from '../settings/settings.service';

/** docs/architecture/caching.md: retrieval results are cached for 15 minutes. */
const RETRIEVAL_CACHE_TTL_SECONDS = 15 * 60;

export interface RetrieveOptions {
  /** Candidates fetched before the threshold filter; defaults to settings. */
  topK?: number;
  /** Minimum similarity (1 − cosine distance); defaults to settings. */
  threshold?: number;
}

/**
 * Retrieval — vector search over `chunks` (FR-4, NFR-1). Embed → pgvector
 * cosine top-k → threshold filter, with the embedding cache inside `llm` and
 * a versioned retrieval cache on top (both fail-open, NFR-9). Scores and
 * timings travel in the trace for `answer_events`.
 */
@Injectable()
export class RetrievalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly llm: LlmService,
    private readonly settings: SettingsService,
    private readonly cache: CacheService,
  ) {}

  async retrieve(
    query: string,
    kbIds: string[],
    options: RetrieveOptions = {},
  ): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const normalizedQuery = normalizeQuery(query);
    const uniqueKbIds = [...new Set(kbIds)].sort();
    const settings = await this.settings.get();
    const topK = options.topK ?? settings.retrieval_top_k;
    const threshold = options.threshold ?? settings.retrieval_score_threshold;

    const trace: RetrievalTrace = {
      query,
      normalizedQuery,
      kbIds: uniqueKbIds,
      topK,
      threshold,
      bestScore: null,
      returnedChunks: 0,
      cacheHit: false,
      embeddingMs: 0,
      searchMs: 0,
      totalMs: 0,
    };

    const finish = (found: RetrievedChunk[]): RetrievalResult => {
      trace.returnedChunks = found.length;
      trace.bestScore = found[0]?.score ?? null;
      trace.totalMs = Date.now() - startedAt;
      return { chunks: found, trace };
    };

    // Nothing to search for (e.g. a bot answer in an inbox without KBs).
    if (!normalizedQuery || uniqueKbIds.length === 0) {
      return finish([]);
    }

    const cacheKey = await this.retrievalCacheKey(normalizedQuery, uniqueKbIds);
    const cached = await this.cache.get<RetrievedChunk[]>(cacheKey);
    if (cached) {
      trace.cacheHit = true;
      return finish(cached);
    }

    const embeddingStarted = Date.now();
    const { embeddings } = await this.llm.embed([normalizedQuery]);
    const embedding = embeddings[0];
    if (!embedding) {
      throw new Error('embedding provider returned no vector');
    }
    trace.embeddingMs = Date.now() - embeddingStarted;

    const searchStarted = Date.now();
    // pgvector operators need a vector literal; the JSON array form casts.
    const vector = `[${embedding.join(',')}]`;
    const similarity = sql<number>`1 - (${chunks.embedding} <=> ${vector}::vector)`;

    const rows = await this.database.db
      .select({
        chunkId: chunks.id,
        documentId: chunks.documentId,
        kbId: chunks.kbId,
        content: chunks.content,
        metadata: chunks.metadata,
        filename: documents.filename,
        score: similarity,
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(and(inArray(chunks.kbId, uniqueKbIds), sql`${similarity} >= ${threshold}`))
      .orderBy(sql`${chunks.embedding} <=> ${vector}::vector`)
      .limit(topK);
    trace.searchMs = Date.now() - searchStarted;

    const found: RetrievedChunk[] = rows.map((row) => ({
      chunkId: row.chunkId,
      documentId: row.documentId,
      kbId: row.kbId,
      filename: row.filename,
      score: Number(row.score),
      metadata: (row.metadata ?? {}) as RetrievedChunkMetadata,
      content: row.content,
    }));

    await this.cache.set(cacheKey, found, RETRIEVAL_CACHE_TTL_SECONDS);
    return finish(found);
  }

  /**
   * `ret:v1:{kbId=version,…}:sha256(query)` — the KB version counters are part
   * of the key, so re-ingesting or deleting a document invalidates results
   * without explicit busting (caching.md).
   */
  private async retrievalCacheKey(normalizedQuery: string, kbIds: string[]): Promise<string> {
    const versions = await Promise.all(
      kbIds.map(async (kbId) => {
        const version = await this.cache.get<number>(kbVersionKey(kbId));
        return `${kbId}=${version ?? 0}`;
      }),
    );
    const queryHash = createHash('sha256').update(normalizedQuery, 'utf8').digest('hex');
    return `ret:v1:${versions.join(',')}:${queryHash}`;
  }
}

/** Cache identity: trim + collapse whitespace (same text → same entry). */
function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}
