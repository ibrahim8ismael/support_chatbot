import { describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../../db/database.service';
import { ConversationsService } from './conversations.service';
import { messages } from './entities/message.entity';

const CONVERSATION_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  chatwootAccountId: 1,
  chatwootConversationId: 42,
  chatwootInboxId: 3,
  contactChatwootId: 7,
  contactName: 'Ada',
  botState: 'active' as const,
  lastMessageAt: null as Date | null,
  createdAt: new Date('2026-10-18T10:00:00Z'),
  updatedAt: new Date('2026-10-18T10:00:00Z'),
};

const MESSAGE_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  conversationId: CONVERSATION_ROW.id,
  chatwootMessageId: 900,
  direction: 'incoming' as const,
  senderType: 'contact' as const,
  content: 'hi',
  isPrivate: false,
  createdAt: new Date('2026-10-18T10:01:00Z'),
};

function buildHarness(
  options: {
    upsertRow?: typeof CONVERSATION_ROW | null;
    conversationRow?: typeof CONVERSATION_ROW | null;
    insertedMessage?: typeof MESSAGE_ROW | null;
    existingMessage?: typeof MESSAGE_ROW | null;
    recentRows?: (typeof MESSAGE_ROW)[];
    updatedRow?: typeof CONVERSATION_ROW | null;
  } = {},
) {
  const conversationValues = vi.fn();
  const conflictConfig = vi.fn();
  const conversationUpsertReturning = vi.fn(async () =>
    options.upsertRow === null ? [] : [options.upsertRow ?? CONVERSATION_ROW],
  );

  const messageValues = vi.fn();
  const conflictNothingConfig = vi.fn();
  const messageInsertReturning = vi.fn(async () =>
    options.insertedMessage === null ? [] : [options.insertedMessage ?? MESSAGE_ROW],
  );

  const conversationsInsert = {
    values: (values: unknown) => {
      conversationValues(values);
      return {
        onConflictDoUpdate: (config: unknown) => {
          conflictConfig(config);
          return { returning: conversationUpsertReturning };
        },
      };
    },
  };
  const messagesInsert = {
    values: (values: unknown) => {
      messageValues(values);
      return {
        onConflictDoNothing: (config: unknown) => {
          conflictNothingConfig(config);
          return { returning: messageInsertReturning };
        },
      };
    },
  };
  const insert = vi.fn((table: unknown) =>
    table === messages ? messagesInsert : conversationsInsert,
  );

  const conversationLimit = vi.fn(async () =>
    options.conversationRow === null ? [] : [options.conversationRow ?? CONVERSATION_ROW],
  );
  const duplicateLimit = vi.fn(async () =>
    options.existingMessage ? [options.existingMessage] : [],
  );
  const recentLimit = vi.fn(async () => options.recentRows ?? []);
  const lastMessageSet = vi.fn();
  const botStateSet = vi.fn();

  const select = vi.fn(() => ({
    from: (table: unknown) =>
      table === messages
        ? {
            where: () => ({
              limit: duplicateLimit,
              orderBy: () => ({ limit: recentLimit }),
            }),
          }
        : { where: () => ({ limit: conversationLimit }) },
  }));

  const update = vi.fn(() => ({
    set: (values: Record<string, unknown>) => {
      if ('lastMessageAt' in values) {
        lastMessageSet(values);
        return { where: async () => [] };
      }
      botStateSet(values);
      return {
        where: () => ({
          returning: async () =>
            options.updatedRow === null ? [] : [options.updatedRow ?? CONVERSATION_ROW],
        }),
      };
    },
  }));

  const database = { db: { insert, select, update } } as unknown as DatabaseService;
  const service = new ConversationsService(database);

  return {
    service,
    conversationValues,
    conflictConfig,
    messageValues,
    conflictNothingConfig,
    conversationLimit,
    duplicateLimit,
    recentLimit,
    lastMessageSet,
    botStateSet,
    select,
  };
}

describe('ConversationsService.upsertConversation', () => {
  it('upserts by chatwoot ids and returns the row', async () => {
    const harness = buildHarness();

    const row = await harness.service.upsertConversation({
      chatwootAccountId: 1,
      chatwootConversationId: 42,
      chatwootInboxId: 3,
      contactChatwootId: 7,
      contactName: 'Ada',
    });

    expect(row).toEqual(CONVERSATION_ROW);
    expect(harness.conversationValues).toHaveBeenCalledWith(
      expect.objectContaining({ chatwootConversationId: 42, contactName: 'Ada' }),
    );
    const config = harness.conflictConfig.mock.calls[0]?.[0] as {
      target: unknown[];
      set: { updatedAt: Date };
    };
    expect(config.target).toHaveLength(2);
    expect(config.set.updatedAt).toBeInstanceOf(Date);
  });

  it('throws when the upsert returns no row', async () => {
    const harness = buildHarness({ upsertRow: null });

    await expect(
      harness.service.upsertConversation({
        chatwootAccountId: 1,
        chatwootConversationId: 42,
        chatwootInboxId: 3,
        contactChatwootId: 7,
      }),
    ).rejects.toThrow('conversation upsert returned no row');
  });
});

describe('ConversationsService.recordMessage', () => {
  const input = {
    conversationId: CONVERSATION_ROW.id,
    chatwootMessageId: 900,
    direction: 'incoming' as const,
    senderType: 'contact' as const,
    content: 'hi',
  };

  it('inserts new messages and bumps last_message_at', async () => {
    const harness = buildHarness();
    const createdAt = new Date('2026-10-18T10:01:00Z');

    const result = await harness.service.recordMessage({ ...input, createdAt });

    expect(result.created).toBe(true);
    expect(result.message).toEqual(MESSAGE_ROW);
    expect(harness.messageValues).toHaveBeenCalledWith(
      expect.objectContaining({ chatwootMessageId: 900, createdAt }),
    );
    expect(harness.lastMessageSet).toHaveBeenCalledWith({ lastMessageAt: createdAt });
  });

  it('dedupes by chatwoot_message_id and leaves last_message_at alone', async () => {
    const harness = buildHarness({ insertedMessage: null, existingMessage: MESSAGE_ROW });

    const result = await harness.service.recordMessage(input);

    expect(result.created).toBe(false);
    expect(result.message).toEqual(MESSAGE_ROW);
    expect(harness.lastMessageSet).not.toHaveBeenCalled();
  });

  it('throws when a conflicted message cannot be re-read', async () => {
    const harness = buildHarness({ insertedMessage: null, existingMessage: null });

    await expect(harness.service.recordMessage(input)).rejects.toThrow('vanished between writes');
  });
});

describe('ConversationsService.recentMessages', () => {
  it('returns oldest → newest and honours the limit', async () => {
    const older = { ...MESSAGE_ROW, id: 'm1', createdAt: new Date('2026-10-18T10:00:00Z') };
    const newer = { ...MESSAGE_ROW, id: 'm2', createdAt: new Date('2026-10-18T10:02:00Z') };
    const harness = buildHarness({ recentRows: [newer, older] }); // desc from the DB

    const rows = await harness.service.recentMessages(CONVERSATION_ROW.id, { limit: 2 });

    expect(rows.map((row) => row.id)).toEqual(['m1', 'm2']);
    expect(harness.recentLimit).toHaveBeenCalledWith(2);
  });
});

describe('ConversationsService lookups', () => {
  it('findByChatwootId returns null when nothing matches', async () => {
    const harness = buildHarness({ conversationRow: null });

    await expect(harness.service.findByChatwootId(1, 42)).resolves.toBeNull();
  });

  it('findById returns the row when it exists', async () => {
    const harness = buildHarness();

    await expect(harness.service.findById(CONVERSATION_ROW.id)).resolves.toEqual(CONVERSATION_ROW);
  });
});

describe('ConversationsService.setBotState', () => {
  it('writes the new state and returns the row', async () => {
    const harness = buildHarness();

    const row = await harness.service.setBotState(CONVERSATION_ROW.id, 'paused');

    expect(row).toEqual(CONVERSATION_ROW);
    expect(harness.botStateSet).toHaveBeenCalledWith({ botState: 'paused' });
  });

  it('returns null for unknown conversations', async () => {
    const harness = buildHarness({ updatedRow: null });

    await expect(harness.service.setBotState(CONVERSATION_ROW.id, 'active')).resolves.toBeNull();
  });
});
