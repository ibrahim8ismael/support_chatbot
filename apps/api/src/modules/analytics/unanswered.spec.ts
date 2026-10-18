import { describe, expect, it } from 'vitest';

import {
  UNANSWERED_SIMILARITY_THRESHOLD,
  clusterUnanswered,
  jaccard,
  tokenize,
} from './unanswered';

describe('tokenize / jaccard', () => {
  it('normalizes case, punctuation and short tokens', () => {
    expect([...tokenize('How do I reset MY password?!')]).toEqual([
      'how',
      'do',
      'reset',
      'my',
      'password',
    ]);
  });

  it('scores overlap on the union of tokens', () => {
    const a = tokenize('reset my password');
    const b = tokenize('reset the password');

    expect(jaccard(a, b)).toBeCloseTo(0.5);
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(new Set(), new Set())).toBe(1);
  });
});

describe('clusterUnanswered', () => {
  it('merges variants above the threshold and keeps unrelated queries apart', () => {
    const soon = new Date('2026-10-18T10:00:00.000Z');
    const earlier = new Date('2026-10-18T09:00:00.000Z');
    const clusters = clusterUnanswered(
      [
        { queryText: 'how do i reset my password', createdAt: soon, conversationId: 'c1' },
        { queryText: 'How do I reset a password?', createdAt: earlier, conversationId: 'c2' },
        { queryText: 'where is my invoice', createdAt: earlier, conversationId: 'c3' },
      ],
      10,
    );

    expect(clusters).toHaveLength(2);
    // Most recent variant wins the tie for the representative text.
    expect(clusters[0]).toEqual({
      query: 'how do i reset my password',
      count: 2,
      lastSeen: soon.toISOString(),
      sampleConversationId: 'c1',
    });
    expect(clusters[1]?.query).toBe('where is my invoice');
  });

  it('orders by count then recency and caps at the limit', () => {
    const t = (minutes: number): Date => new Date(Date.UTC(2026, 9, 18, 8, minutes));
    const clusters = clusterUnanswered(
      [
        { queryText: 'refund please', createdAt: t(1), conversationId: 'a' },
        { queryText: 'refund please', createdAt: t(2), conversationId: 'b' },
        { queryText: 'refund please', createdAt: t(3), conversationId: 'c' },
        { queryText: 'missing invoice', createdAt: t(4), conversationId: 'd' },
        { queryText: 'missing invoice', createdAt: t(5), conversationId: 'e' },
        { queryText: 'human now', createdAt: t(6), conversationId: 'f' },
      ],
      2,
    );

    expect(clusters.map((cluster) => cluster.count)).toEqual([3, 2]);
    expect(clusters[0]?.query).toBe('refund please');
    // Most recent occurrence in the group drives lastSeen/sample.
    expect(clusters[0]?.sampleConversationId).toBe('c');
    expect(clusters[1]?.sampleConversationId).toBe('e');
  });

  it('picks the most frequent variant as the representative', () => {
    const clusters = clusterUnanswered(
      [
        {
          queryText: 'reset my password',
          createdAt: new Date('2026-10-18T09:00:00Z'),
          conversationId: 'c1',
        },
        {
          queryText: 'reset my password',
          createdAt: new Date('2026-10-18T09:01:00Z'),
          conversationId: 'c2',
        },
        {
          queryText: 'reset a password',
          createdAt: new Date('2026-10-18T10:00:00Z'),
          conversationId: 'c3',
        },
      ],
      10,
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.query).toBe('reset my password');
    expect(clusters[0]?.count).toBe(3);
  });

  it('uses the documented threshold constant', () => {
    expect(UNANSWERED_SIMILARITY_THRESHOLD).toBeGreaterThan(0);
    expect(UNANSWERED_SIMILARITY_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
