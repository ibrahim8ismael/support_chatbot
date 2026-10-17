/**
 * Retrieval contracts (FR-4) — consumed by the agent, the debug endpoint, and
 * later the playground. Chunk metadata mirrors what ingestion stores
 * (docs/architecture/data-model.md § chunks).
 */

/** Metadata ingestion kept alongside a chunk. */
export interface RetrievedChunkMetadata {
  heading?: string;
  page?: number;
  source_url?: string;
}

/** One scored chunk, ready to be composed into an answer prompt. */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  kbId: string;
  /** Display-only source label; never exposed to customers (FR-4). */
  filename: string;
  /** Cosine similarity (1 − distance); higher is better. */
  score: number;
  metadata: RetrievedChunkMetadata;
  content: string;
}

/**
 * What happened during a search — the trace the debug endpoint returns and
 * the agent folds into `answer_events` (this module never writes events
 * itself: the analytics row needs conversation/message context).
 */
export interface RetrievalTrace {
  query: string;
  /** Cache identity: trimmed, whitespace-collapsed (caching.md). */
  normalizedQuery: string;
  kbIds: string[];
  /** Candidates fetched before the threshold filter (resolved setting). */
  topK: number;
  /** Minimum similarity a chunk must clear (resolved setting). */
  threshold: number;
  /** Highest returned similarity, `null` when nothing matched. */
  bestScore: number | null;
  /** Chunks returned after threshold + limit. */
  returnedChunks: number;
  cacheHit: boolean;
  embeddingMs: number;
  searchMs: number;
  totalMs: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  trace: RetrievalTrace;
}
