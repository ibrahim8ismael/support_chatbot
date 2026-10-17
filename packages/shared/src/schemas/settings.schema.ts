import { z } from 'zod';

/**
 * Typed runtime settings (docs/architecture/data-model.md § settings).
 * Secrets never live here — environment only (docs/operations/security.md).
 * Defaults are applied by the API on read; values are validated on write.
 */
export const settingsSchema = z.strictObject({
  /** Global kill switch — when false the bot posts nothing, anywhere. */
  bot_enabled: z.boolean(),
  system_prompt: z.string().min(1).max(20_000),
  fallback_message: z.string().min(1).max(1_000),
  /** Candidates fetched by retrieval before filtering. */
  retrieval_top_k: z.number().int().min(1).max(50),
  /** Minimum similarity (1 - cosine distance) required to attempt an answer. */
  retrieval_score_threshold: z.number().min(0).max(1),
  /** Chunks placed into the answer prompt. */
  context_chunks: z.number().int().min(1).max(20),
  /** Hard cap applied to generated replies before posting. */
  max_reply_chars: z.number().int().min(100).max(4_000),
  embedding_model: z.string().min(1).max(200),
  chat_model: z.string().min(1).max(200),
});

export type Settings = z.infer<typeof settingsSchema>;

/** `PUT /settings` body: partial update, validated per key, at least one key. */
export const settingsUpdateSchema = settingsSchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'provide at least one setting',
  });

export type SettingsPatch = z.infer<typeof settingsUpdateSchema>;
