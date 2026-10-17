import { describe, expect, it } from 'vitest';

import { settingsUpdateSchema } from '@support-agent/shared';

describe('settingsUpdateSchema', () => {
  it('accepts a partial patch', () => {
    const result = settingsUpdateSchema.safeParse({ retrieval_top_k: 12 });

    expect(result.success).toBe(true);
  });

  it('rejects unknown keys (typos must not be silently persisted)', () => {
    const result = settingsUpdateSchema.safeParse({ retrieval_top_key: 12 });

    expect(result.success).toBe(false);
  });

  it('rejects an empty patch', () => {
    const result = settingsUpdateSchema.safeParse({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('provide at least one setting');
    }
  });

  it('enforces per-key ranges', () => {
    expect(settingsUpdateSchema.safeParse({ retrieval_score_threshold: 1.5 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ max_reply_chars: 10 }).success).toBe(false);
    expect(settingsUpdateSchema.safeParse({ context_chunks: 1.5 }).success).toBe(false);
  });
});
