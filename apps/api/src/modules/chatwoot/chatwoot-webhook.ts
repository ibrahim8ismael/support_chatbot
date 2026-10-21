import { z } from 'zod';

import type { ChatwootWebhookJob } from '@support-agent/shared';

const chatwootIdSchema = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)])
  .refine(Number.isSafeInteger, 'id must be a safe integer');

const labelsSchema = z.array(z.union([z.string(), z.object({ title: z.string() }).passthrough()]));

const senderSchema = z
  .object({
    id: chatwootIdSchema.optional(),
    name: z.string().nullable().optional(),
    type: z.string().optional(),
  })
  .passthrough();

const conversationSchema = z
  .object({
    id: chatwootIdSchema,
    inbox_id: chatwootIdSchema.optional(),
    assignee_id: chatwootIdSchema.nullable().optional(),
    assignee: z.unknown().optional(),
    labels: labelsSchema.optional(),
    meta: z
      .object({ sender: z.object({ id: chatwootIdSchema.optional() }).passthrough().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const accountSchema = z.object({ id: chatwootIdSchema }).passthrough();

const messageCreatedSchema = z
  .object({
    event: z.literal('message_created'),
    id: chatwootIdSchema,
    content: z.string().nullable().optional(),
    content_type: z.string().optional().default('text'),
    message_type: z.union([z.string(), z.number()]),
    created_at: z.union([z.string(), z.number()]).optional(),
    private: z.boolean().optional().default(false),
    sender: senderSchema,
    conversation: conversationSchema,
    attachments: z.array(z.unknown()).optional().default([]),
    inbox_id: chatwootIdSchema.optional(),
    account: accountSchema.optional(),
  })
  .passthrough();

const conversationUpdatedSchema = z
  .object({
    event: z.literal('conversation_updated'),
    id: chatwootIdSchema,
    inbox_id: chatwootIdSchema,
    assignee_id: chatwootIdSchema.nullable().optional(),
    assignee: z.unknown().optional(),
    labels: labelsSchema.optional(),
    account: accountSchema.optional(),
  })
  .passthrough();

/**
 * Parse only event shapes the app acts on. Chatwoot Agent Bot events are
 * object-specific: message events nest `conversation`, while conversation
 * events carry conversation fields at the top level.
 */
export function parseChatwootWebhook(
  input: unknown,
  defaultAccountId: number,
): ChatwootWebhookJob | null {
  if (!isRecord(input) || typeof input.event !== 'string') {
    return null;
  }

  if (input.event === 'message_created') {
    const parsed = messageCreatedSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(
        `invalid message_created payload: ${parsed.error.issues[0]?.path.join('.') ?? 'payload'}`,
      );
    }
    const event = parsed.data;
    if (!isIncoming(event.message_type) || event.private || event.sender.type !== 'contact') {
      return null;
    }

    const inboxId = event.conversation.inbox_id ?? event.inbox_id;
    const contactId = event.sender.id ?? event.conversation.meta?.sender?.id;
    const accountId = event.account?.id ?? defaultAccountId;
    if (!inboxId || !contactId || accountId !== defaultAccountId) {
      return null;
    }

    return {
      kind: 'message_created',
      accountId,
      chatwootMessageId: event.id,
      chatwootConversationId: event.conversation.id,
      chatwootInboxId: inboxId,
      contactChatwootId: contactId,
      contactName: event.sender.name ?? null,
      content: event.content ?? '',
      contentType: event.content_type,
      hasAttachments: event.attachments.length > 0,
      createdAt: toIsoDate(event.created_at),
      assigneeId: assignedId(event.conversation.assignee_id, event.conversation.assignee),
      labels: normalizeLabels(event.conversation.labels ?? []),
    };
  }

  if (input.event === 'conversation_updated') {
    const parsed = conversationUpdatedSchema.safeParse(input);
    if (!parsed.success) {
      // Chatwoot's newer conversation_updated shape is conversation-shaped and
      // intentionally differs from message_created.
      return null;
    }
    const event = parsed.data;
    const accountId = event.account?.id ?? defaultAccountId;
    if (accountId !== defaultAccountId) {
      return null;
    }
    return {
      kind: 'conversation_updated',
      accountId,
      chatwootConversationId: event.id,
      chatwootInboxId: event.inbox_id,
      ...(event.assignee_id !== undefined || event.assignee !== undefined
        ? { assigneeId: assignedId(event.assignee_id, event.assignee) }
        : {}),
      ...(event.labels !== undefined ? { labels: normalizeLabels(event.labels) } : {}),
    };
  }

  return null;
}

function isIncoming(messageType: string | number): boolean {
  return messageType === 'incoming' || messageType === 0 || messageType === '0';
}

function normalizeLabels(labels: Array<string | { title: string }>): string[] {
  return labels.map((label) => (typeof label === 'string' ? label : label.title));
}

function assignedId(value: number | null | undefined, assignee: unknown): number | null {
  if (value !== undefined) return value;
  if (isRecord(assignee) && typeof assignee.id === 'number' && Number.isSafeInteger(assignee.id)) {
    return assignee.id;
  }
  if (assignee === null) return null;
  return null;
}

function toIsoDate(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
