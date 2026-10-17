import { Injectable } from '@nestjs/common';

/**
 * Retrieval — reads `chunks`, writes `retrieval_events`.
 * Exposes to other modules: retrieve(query, kbIds, opts) → chunks + scores.
 * Does NOT do: talking to models directly (uses `llm` for embeddings).
 *
 * TODO(retrieval): pgvector cosine search (HNSW), filters, score threshold from
 * `settings`; prompts for query rewriting live in this module as versioned files.
 */
@Injectable()
export class RetrievalService {}
