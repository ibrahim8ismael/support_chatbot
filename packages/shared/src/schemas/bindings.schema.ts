import { z } from 'zod';

/**
 * Inbox ↔ KB bindings (docs/architecture/data-model.md § inbox_bindings).
 * Empty `kbIds` or `enabled=false` means the bot is off for that inbox.
 */

/** `PUT /bindings/:chatwootInboxId` body — full state, not a patch. */
export const bindingUpdateSchema = z.strictObject({
  kbIds: z
    .array(z.uuid())
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'kbIds must be unique' }),
  enabled: z.boolean(),
});

export type BindingUpdate = z.infer<typeof bindingUpdateSchema>;

/** Admin-facing binding shape; `displayName` is cached from Chatwoot. */
export const inboxBindingSchema = z.object({
  id: z.uuid(),
  chatwootAccountId: z.number().int(),
  chatwootInboxId: z.number().int(),
  kbIds: z.array(z.uuid()),
  enabled: z.boolean(),
  displayName: z.string().nullable(),
});

export type InboxBinding = z.infer<typeof inboxBindingSchema>;
