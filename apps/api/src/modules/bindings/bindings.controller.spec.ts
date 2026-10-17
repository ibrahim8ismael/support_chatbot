import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { InboxBinding } from '@support-agent/shared';

import { BindingsController } from './bindings.controller';
import type { BindingsService } from './bindings.service';

const BINDING: InboxBinding = {
  id: '33333333-3333-4333-8333-333333333333',
  chatwootAccountId: 1,
  chatwootInboxId: 3,
  kbIds: ['11111111-1111-4111-8111-111111111111'],
  enabled: true,
  displayName: 'Website',
};

function buildHarness() {
  const service = {
    list: vi.fn(async () => [BINDING]),
    upsert: vi.fn(async () => BINDING),
  } as unknown as BindingsService;

  return { controller: new BindingsController(service), service };
}

describe('BindingsController', () => {
  it('lists bindings', async () => {
    const { controller } = buildHarness();

    await expect(controller.list()).resolves.toEqual([BINDING]);
  });

  it('upserts the full state for an inbox', async () => {
    const { controller, service } = buildHarness();
    const body = { kbIds: [BINDING.kbIds[0] ?? ''], enabled: false };

    await expect(controller.upsert(3, body)).resolves.toEqual(BINDING);
    expect(service.upsert).toHaveBeenCalledWith(3, body);
  });

  it('rejects non-positive inbox ids before touching the service', () => {
    const { controller, service } = buildHarness();

    expect(() => controller.upsert(0, { kbIds: [], enabled: true })).toThrow(BadRequestException);
    expect(service.upsert).not.toHaveBeenCalled();
  });
});
