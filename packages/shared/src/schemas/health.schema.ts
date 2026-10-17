import { z } from 'zod';

/** Payload of `GET /health` — see docs/api/rest-api.md. */
export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'error']),
  redis: z.enum(['ok', 'error']),
  queue: z.enum(['ok', 'error']),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
