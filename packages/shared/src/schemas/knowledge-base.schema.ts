import { z } from 'zod';

import { DOCUMENT_SOURCE_TYPES, DOCUMENT_STATUSES, KB_STATUSES } from '../types/domain';

/**
 * Knowledge base + document contracts (docs/api/rest-api.md,
 * docs/architecture/data-model.md). Timestamps leave the API as ISO strings.
 */

export const knowledgeBaseInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
});

export type KnowledgeBaseInput = z.infer<typeof knowledgeBaseInputSchema>;

/** Pasted knowledge follows the same indexing pipeline as an uploaded document. */
export const textDocumentInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(200_000),
});

export type TextDocumentInput = z.infer<typeof textDocumentInputSchema>;

/** `PATCH /knowledge-bases/:id` — rename, re-describe, archive. */
export const knowledgeBaseUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    status: z.enum(KB_STATUSES).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'provide at least one field',
  });

export type KnowledgeBaseUpdate = z.infer<typeof knowledgeBaseUpdateSchema>;

export const knowledgeBaseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(KB_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

/** List/detail shape: KB plus document counts for the dashboard. */
export const knowledgeBaseSummarySchema = knowledgeBaseSchema.extend({
  documentCount: z.number().int(),
  statusCounts: z.object({
    processing: z.number().int(),
    ready: z.number().int(),
    failed: z.number().int(),
  }),
});

export type KnowledgeBaseSummary = z.infer<typeof knowledgeBaseSummarySchema>;

export const knowledgeDocumentSchema = z.object({
  id: z.uuid(),
  kbId: z.uuid(),
  sourceType: z.enum(DOCUMENT_SOURCE_TYPES),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.enum(DOCUMENT_STATUSES),
  error: z.string().nullable(),
  chunkCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;
