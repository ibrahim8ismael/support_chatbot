import { describe, expect, it } from 'vitest';

import { bindingUpdateSchema } from '@support-agent/shared';

const KB = '11111111-1111-4111-8111-111111111111';

describe('bindingUpdateSchema', () => {
  it('accepts a full binding state', () => {
    expect(bindingUpdateSchema.safeParse({ kbIds: [KB], enabled: false }).success).toBe(true);
  });

  it('accepts an empty kb list (bot off for the inbox)', () => {
    expect(bindingUpdateSchema.safeParse({ kbIds: [], enabled: true }).success).toBe(true);
  });

  it('rejects duplicate kb ids', () => {
    const result = bindingUpdateSchema.safeParse({ kbIds: [KB, KB], enabled: true });

    expect(result.success).toBe(false);
  });

  it('rejects unknown keys and bad uuids', () => {
    expect(
      bindingUpdateSchema.safeParse({ kbIds: [KB], enabled: true, display_name: 'x' }).success,
    ).toBe(false);
    expect(bindingUpdateSchema.safeParse({ kbIds: ['not-a-uuid'], enabled: true }).success).toBe(
      false,
    );
  });
});
