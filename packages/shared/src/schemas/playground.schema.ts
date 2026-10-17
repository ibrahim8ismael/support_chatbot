import { z } from 'zod';

/** One prior turn sent with a playground question. */
export const playgroundTurnSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4_000),
});

/** `POST /playground/ask` (rest-api.md): full pipeline, no Chatwoot. */
export const playgroundAskSchema = z.strictObject({
  question: z.string().min(1).max(2_000),
  kbIds: z.array(z.uuid()).min(1).max(10),
  /** Recent conversation, oldest first; the playground UI provides what it has. */
  history: z.array(playgroundTurnSchema).max(20).optional(),
});

export type PlaygroundAsk = z.infer<typeof playgroundAskSchema>;
export type PlaygroundTurn = z.infer<typeof playgroundTurnSchema>;
