import { z } from 'zod';
import { USER_ROLES } from '../types/domain';
import { newPasswordSchema } from './auth.schema';

/**
 * User management contracts (docs/api/rest-api.md § Users — admin only).
 * These are inputs for `UsersController`; responses use `UserSummary`.
 */

/** `POST /users` body — create a user (admin). */
export const userCreateSchema = z.strictObject({
  email: z.email(),
  name: z.string().trim().min(1).max(120),
  role: z.enum(USER_ROLES),
  password: newPasswordSchema,
});

export type UserCreate = z.infer<typeof userCreateSchema>;

/** `PATCH /users/:id` body — partial update, at least one field. */
export const userUpdateSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'provide at least one field',
  });

export type UserUpdate = z.infer<typeof userUpdateSchema>;

/** `POST /users/:id/password` body — admin password reset. */
export const userPasswordResetSchema = z.strictObject({
  password: newPasswordSchema,
});

export type UserPasswordReset = z.infer<typeof userPasswordResetSchema>;

/** User shape in responses — never the password hash. */
export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: (typeof USER_ROLES)[number];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
