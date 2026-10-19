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

const LIST_ROW = {
  id: CONVERSATION_ROW.id,
  chatwoot_conversation_id: 42,
  chatwoot_inbox_id: 3,
  contact_name: 'Ada',
  bot_state: 'active',
  last_message_at: new Date('2026-10-18T10:05:00Z'),
  created_at: new Date('2026-10-18T10:00:00Z'),
  total: 1,
};

const ANSWER_EVENT_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  outcome: 'answered',
  query_text: 'how do i reset my password?',
  top_k: 4,
  top_score: 0.81,
  retrieved_chunk_ids: ['chunk-b', 'chunk-a', 'chunk-missing'],
  embedding_ms: 20,
  retrieval_ms: 15,
  generation_ms: 800,
  total_ms: 835,
  embedding_model: 'text-embedding-3-small',
  chat_model: 'gpt-4o-mini',
  tokens_in: 500,
  tokens_out: 90,
  estimated_cost_usd: '0.000420',
  created_at: new Date('2026-10-18T10:02:00Z'),
};

/** Explorer methods go through raw SQL — canned `execute` rows, in call order. */
function buildExplorerHarness(results: unknown[][]) {
  const queue = [...results];
  const execute = vi.fn(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error('no canned execute result');
    }
    return next;
  });
  const database = { db: { execute } } as unknown as DatabaseService;
  return { service: new ConversationsService(database), execute };
}

describe('ConversationsService.listForExplorer', () => {
  it('maps rows to summaries and carries the window total', async () => {
    const harness = buildExplorerHarness([[LIST_ROW]]);

    const result = await harness.service.listForExplorer({ limit: 50, offset: 0 });

    expect(result).toEqual({
      items: [
        {
          id: CONVERSATION_ROW.id,
          chatwootConversationId: 42,
          chatwootInboxId: 3,
          contactName: 'Ada',
          botState: 'active',
          lastMessageAt: '2026-10-18T10:05:00.000Z',
          createdAt: '2026-10-18T10:00:00.000Z',
        },
      ],
      total: 1,
    });
  });

  it('returns an empty page with total 0 and null last_message_at', async () => {
    const empty = buildExplorerHarness([[]]);
    await expect(empty.service.listForExplorer({ limit: 50, offset: 0 })).resolves.toEqual({
      items: [],
      total: 0,
    });

    const nullLast = buildExplorerHarness([[{ ...LIST_ROW, last_message_at: null }]]);
    const result = await nullLast.service.listForExplorer({ limit: 50, offset: 0 });
    expect(result.items[0]?.lastMessageAt).toBeNull();
  });

  it('rejects an inverted range before touching the database', async () => {
    const harness = buildExplorerHarness([]);

    await expect(
      harness.service.listForExplorer({
        from: '2026-10-18T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
        limit: 50,
        offset: 0,
      }),
    ).rejects.toThrow('from must be before to');
    expect(harness.execute).not.toHaveBeenCalled();
  });
});

describe('ConversationsService.detailForExplorer', () => {
  const MESSAGE_ROW_1 = {
    id: 'msg-1',
    direction: 'incoming',
    sender_type: 'contact',
    content: 'how do i reset my password?',
    is_private: false,
    created_at: new Date('2026-10-18T10:01:00Z'),
  };
  const MESSAGE_ROW_2 = {
    id: 'msg-2',
    direction: 'outgoing',
    sender_type: 'system',
    content: 'Escalated to a human.',
    is_private: true,
    created_at: new Date('2026-10-18T10:03:00Z'),
  };
  const CHUNK_ROWS = [
    {
      id: 'chunk-a',
      document_id: 'doc-1',
      chunk_index: 2,
      content: 'Password reset steps…',
      filename: 'faq.md',
    },
    {
      id: 'chunk-b',
      document_id: 'doc-2',
      chunk_index: 0,
      content: 'Account settings…',
      filename: null,
    },
  ];

  it('returns the thread plus ranked answer events with chunks for admins', async () => {
    const harness = buildExplorerHarness([
      [LIST_ROW],
      [MESSAGE_ROW_2, MESSAGE_ROW_1],
      [ANSWER_EVENT_ROW],
      CHUNK_ROWS,
    ]);

    const detail = await harness.service.detailForExplorer(CONVERSATION_ROW.id, {
      includeAnswerEvents: true,
    });

    expect(detail.conversation.contactName).toBe('Ada');
    expect(detail.answerEventsRestricted).toBe(false);
    expect(detail.messages).toEqual([
      expect.objectContaining({ id: 'msg-1', senderType: 'contact', isPrivate: false }),
      expect.objectContaining({ id: 'msg-2', isPrivate: true }),
    ]);

    const [event] = detail.answerEvents;
    expect(event).toEqual(
      expect.objectContaining({
        outcome: 'answered',
        queryText: 'how do i reset my password?',
        topK: 4,
        topScore: 0.81,
        tokensIn: 500,
        estimatedCostUsd: 0.00042,
        createdAt: '2026-10-18T10:02:00.000Z',
      }),
    );
    // Retrieval-rank order preserved; vanished chunk ids dropped.
    expect(event?.retrievedChunks.map((chunk) => chunk.id)).toEqual(['chunk-b', 'chunk-a']);
    expect(event?.retrievedChunks[0]).toEqual(
      expect.objectContaining({ documentFilename: null, chunkIndex: 0 }),
    );
    expect(harness.execute).toHaveBeenCalledTimes(4);
  });

  it('omits answer events (and the chunk query) for non-admins', async () => {
    const harness = buildExplorerHarness([[LIST_ROW], [MESSAGE_ROW_1]]);

    const detail = await harness.service.detailForExplorer(CONVERSATION_ROW.id, {
      includeAnswerEvents: false,
    });

    expect(detail.answerEvents).toEqual([]);
    expect(detail.answerEventsRestricted).toBe(true);
    expect(harness.execute).toHaveBeenCalledTimes(2);
  });

  it('skips the chunk query when no event cites a chunk', async () => {
    const harness = buildExplorerHarness([
      [LIST_ROW],
      [MESSAGE_ROW_1],
      [{ ...ANSWER_EVENT_ROW, retrieved_chunk_ids: [] }],
    ]);

    const detail = await harness.service.detailForExplorer(CONVERSATION_ROW.id, {
      includeAnswerEvents: true,
    });

    expect(detail.answerEvents[0]?.retrievedChunks).toEqual([]);
    expect(harness.execute).toHaveBeenCalledTimes(3);
  });

  it('throws NotFound when the conversation does not exist', async () => {
    const harness = buildExplorerHarness([[]]);

    await expect(
      harness.service.detailForExplorer(CONVERSATION_ROW.id, { includeAnswerEvents: false }),
    ).rejects.toThrow(`conversation ${CONVERSATION_ROW.id} not found`);
  });
});
