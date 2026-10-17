import { z } from 'zod';

/** `POST /auth/login` body — see docs/api/rest-api.md. */
export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
