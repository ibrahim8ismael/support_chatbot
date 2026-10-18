import type { UnansweredQuestion } from '@support-agent/shared';

/**
 * Top-unanswered grouping (rest-api.md § Analytics): escalation events are
 * clustered by query similarity so "how do I reset my password" and "how can I
 * reset my password?" land in one row. Kept dependency-free and deterministic:
 * token-set Jaccard similarity, newest-first greedy assignment.
 */

/** Token overlap needed to merge two queries into one group. */
export const UNANSWERED_SIMILARITY_THRESHOLD = 0.6;

export interface UnansweredRow {
  queryText: string;
  createdAt: Date;
  conversationId: string;
}

interface Cluster {
  /** Union of all variants' tokens — grows as rows merge in. */
  tokens: Set<string>;
  variants: Map<string, { count: number; lastSeen: Date }>;
  count: number;
  lastSeen: Date;
  sampleConversationId: string;
}

export function tokenize(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Cluster rows (already newest-first) and return the top `limit` groups by
 * occurrence count. The representative text is the most frequent variant,
 * most recent on ties.
 */
export function clusterUnanswered(rows: UnansweredRow[], limit: number): UnansweredQuestion[] {
  const clusters: Cluster[] = [];

  for (const row of rows) {
    const tokens = tokenize(row.queryText);
    let cluster = clusters.find(
      (candidate) => jaccard(candidate.tokens, tokens) >= UNANSWERED_SIMILARITY_THRESHOLD,
    );
    if (!cluster) {
      cluster = {
        tokens: new Set(),
        variants: new Map(),
        count: 0,
        lastSeen: row.createdAt,
        sampleConversationId: row.conversationId,
      };
      clusters.push(cluster);
    }

    for (const token of tokens) {
      cluster.tokens.add(token);
    }
    cluster.count += 1;
    if (row.createdAt > cluster.lastSeen) {
      cluster.lastSeen = row.createdAt;
      cluster.sampleConversationId = row.conversationId;
    }

    const variant = cluster.variants.get(row.queryText) ?? { count: 0, lastSeen: row.createdAt };
    variant.count += 1;
    if (row.createdAt > variant.lastSeen) {
      variant.lastSeen = row.createdAt;
    }
    cluster.variants.set(row.queryText, variant);
  }

  return clusters
    .sort((a, b) => b.count - a.count || b.lastSeen.getTime() - a.lastSeen.getTime())
    .slice(0, limit)
    .map((cluster) => ({
      query: representative(cluster.variants),
      count: cluster.count,
      lastSeen: cluster.lastSeen.toISOString(),
      sampleConversationId: cluster.sampleConversationId,
    }));
}

function representative(variants: Map<string, { count: number; lastSeen: Date }>): string {
  let best = '';
  let bestCount = -1;
  let bestLastSeen = 0;
  for (const [text, variant] of variants) {
    if (
      variant.count > bestCount ||
      (variant.count === bestCount && variant.lastSeen.getTime() > bestLastSeen)
    ) {
      best = text;
      bestCount = variant.count;
      bestLastSeen = variant.lastSeen.getTime();
    }
  }
  return best;
}
