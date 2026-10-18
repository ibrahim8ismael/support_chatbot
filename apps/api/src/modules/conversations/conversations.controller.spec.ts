import { describe, expect, it, vi } from 'vitest';

import type { ConversationDetail, ConversationList, SessionUser } from '@support-agent/shared';

import { ConversationsController } from './conversations.controller';
import type { ConversationsService } from './conversations.service';

const ADMIN: SessionUser = {
  id: '99999999-9999-4999-8999-999999999999',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
};

const VIEWER: SessionUser = { ...ADMIN, role: 'viewer' };

const LIST: ConversationList = {
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      chatwootConversationId: 42,
      chatwootInboxId: 3,
      contactName: 'Ada',
      botState: 'active',
      lastMessageAt: '2026-10-18T10:05:00.000Z',
      createdAt: '2026-10-18T10:00:00.000Z',
    },
  ],
  total: 1,
};

const DETAIL: ConversationDetail = {
  conversation: LIST.items[0]!,
  messages: [],
  answerEvents: [],
  answerEventsRestricted: false,
};

function buildHarness() {
  const listForExplorer = vi.fn(async (_query: unknown) => LIST);
  const detailForExplorer = vi.fn(async (_id: string, _options: unknown) => DETAIL);
  const service = { listForExplorer, detailForExplorer } as unknown as ConversationsService;

  return {
    controller: new ConversationsController(service),
    listForExplorer,
    detailForExplorer,
  };
}

describe('ConversationsController', () => {
  it('delegates the parsed list query to the service', async () => {
    const { controller, listForExplorer } = buildHarness();
    const query = { inboxId: 3, botState: 'paused' as const, limit: 10, offset: 0 };

    await expect(controller.list(query)).resolves.toEqual(LIST);
    expect(listForExplorer).toHaveBeenCalledWith(query);
  });

  it('includes answer events for admins', async () => {
    const { controller, detailForExplorer } = buildHarness();
    const id = '11111111-1111-4111-8111-111111111111';

    await expect(controller.detail(id, ADMIN)).resolves.toEqual(DETAIL);
    expect(detailForExplorer).toHaveBeenCalledWith(id, { includeAnswerEvents: true });
  });

  it('restricts answer events for non-admin roles', async () => {
    const { controller, detailForExplorer } = buildHarness();
    const id = '11111111-1111-4111-8111-111111111111';

    await controller.detail(id, VIEWER);

    expect(detailForExplorer).toHaveBeenCalledWith(id, { includeAnswerEvents: false });
  });
});
