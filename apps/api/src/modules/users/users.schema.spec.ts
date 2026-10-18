import { describe, expect, it } from 'vitest';

import { userCreateSchema, userPasswordResetSchema, userUpdateSchema } from '@support-agent/shared';

describe('user input schemas', () => {
  it('accepts a valid create with a 12+ char password', () => {
    expect(
      userCreateSchema.parse({
        email: 'ada@example.com',
        name: '  Ada Lovelace ',
        role: 'editor',
        password: 'correct horse battery',
      }),
    ).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      role: 'editor',
      password: 'correct horse battery',
    });
  });

  it('rejects bad emails, roles, short passwords and unknown keys', () => {
    const base = {
      email: 'ada@example.com',
      name: 'Ada',
      role: 'editor',
      password: 'correct horse battery',
    };
    expect(userCreateSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, role: 'owner' }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, isActive: false }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
  });

  it('requires at least one field on update and allows partial patches', () => {
    expect(userUpdateSchema.safeParse({}).success).toBe(false);
    expect(userUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(userUpdateSchema.parse({ name: 'Grace', role: 'admin' })).toEqual({
      name: 'Grace',
      role: 'admin',
    });
    expect(userUpdateSchema.safeParse({ password: 'correct horse battery' }).success).toBe(false);
  });

  it('enforces the stored-password policy on resets', () => {
    expect(userPasswordResetSchema.safeParse({ password: 'short' }).success).toBe(false);
    expect(userPasswordResetSchema.safeParse({ password: 'correct horse battery' }).success).toBe(
      true,
    );
    expect(userPasswordResetSchema.safeParse({}).success).toBe(false);
  });
});
