import { customType } from 'drizzle-orm/pg-core';

/**
 * `citext` (case-insensitive text) — used for `users.email` so logins are
 * case-insensitive without lowered copies (data-model.md).
 *
 * drizzle-orm does not ship this type; the migration creates the extension
 * (`CREATE EXTENSION IF NOT EXISTS citext`), this only tells drizzle-kit the
 * column type.
 */
export const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});
