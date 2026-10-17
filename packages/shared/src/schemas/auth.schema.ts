import { z } from 'zod';
import { USER_ROLES } from '../types/domain';

/** `POST /auth/login` body — see docs/api/rest-api.md. */
export const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginInputSchema>;

/** Passwords we *store*: min 12, hashed with argon2id (docs/operations/security.md). */
export const newPasswordSchema = z.string().min(12).max(200);

export type NewPassword = z.infer<typeof newPasswordSchema>;

/** Safe user shape in responses (`/auth/me`, `/auth/login`) — never the hash. */
export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;
