import { describe, expect, it, vi } from 'vitest';

import type { AuditLogList } from '@support-agent/shared';

import { AuditLogController } from './audit-log.controller';
import type { AnalyticsService } from './analytics.service';

const LIST: AuditLogList = {
  items: [
    {
      id: 'aaaaaaaa-1111-4111-8111-111111111111',
      userId: null,
      userEmail: null,
      action: 'auth.login_failed',
      entity: 'session',
      entityId: null,
      data: { email: 'nobody@example.com' },
      createdAt: '2026-10-18T09:00:00.000Z',
    },
  ],
  total: 1,
};

function buildHarness() {
  const listAuditLogs = vi.fn(async (_query: unknown) => LIST);
  const analytics = { listAuditLogs } as unknown as AnalyticsService;

  return { controller: new AuditLogController(analytics), listAuditLogs };
}

describe('AuditLogController', () => {
  it('delegates the parsed query to the analytics service', async () => {
    const { controller, listAuditLogs } = buildHarness();
    const query = {
      userId: 'bbbbbbbb-2222-4222-8222-222222222222',
      action: 'users.update',
      limit: 10,
      offset: 5,
    };

    await expect(controller.list(query)).resolves.toEqual(LIST);
    expect(listAuditLogs).toHaveBeenCalledWith(query);
  });
});
