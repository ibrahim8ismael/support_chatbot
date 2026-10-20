import { describe, expect, it } from 'vitest';

import { sandboxRetryJobId, sandboxRunJobId } from './sandbox.jobs';

const RUN_ID = '22222222-2222-4222-8222-222222222222';

describe('sandbox job ids', () => {
  it('builds BullMQ-safe ids for runs', () => {
    expect(sandboxRunJobId(RUN_ID)).toBe(`sandbox-run-${RUN_ID}`);
  });

  it('builds a fresh, BullMQ-safe id for retries', () => {
    expect(sandboxRetryJobId(RUN_ID, 1_700_000_000_000)).toBe(
      `sandbox-run-${RUN_ID}-retry-1700000000000`,
    );
    expect(sandboxRetryJobId(RUN_ID, 1)).not.toBe(sandboxRetryJobId(RUN_ID, 2));
  });

  it('never emits the colon BullMQ rejects', () => {
    expect(sandboxRunJobId(RUN_ID)).not.toContain(':');
    expect(sandboxRetryJobId(RUN_ID, 1)).not.toContain(':');
  });
});
