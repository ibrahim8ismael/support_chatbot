import { z } from 'zod';

/**
 * Debug retrieval request (`POST /knowledge-bases/:id/search`, rest-api.md):
 * runs the real embed + vector-search path with no model generation.
 */
export const retrievalSearchSchema = z.strictObject({
  query: z.string().min(1).max(2_000),
  /** Candidates fetched before the threshold filter; defaults to settings. */
  topK: z.number().int().min(1).max(50).optional(),
});

export type RetrievalSearch = z.infer<typeof retrievalSearchSchema>;
