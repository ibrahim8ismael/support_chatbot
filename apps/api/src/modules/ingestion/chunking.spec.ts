import { describe, expect, it } from 'vitest';

import { CHUNK_TARGET_TOKENS, chunkBlocks } from './chunking';
import type { RawBlock } from './parsers/types';

const words = (count: number): string =>
  Array.from({ length: count }, (_, index) => `w${index}`).join(' ');

describe('chunkBlocks', () => {
  it('returns a single chunk for a short document', () => {
    expect(chunkBlocks([{ text: 'Short paragraph.' }])).toEqual([
      { content: 'Short paragraph.', tokenCount: 2, metadata: {} },
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(chunkBlocks([])).toEqual([]);
  });

  it('does not duplicate the heading when a chunk starts at the section head', () => {
    const chunks = chunkBlocks([
      { text: 'Password reset', heading: 'Password reset' },
      { text: 'Body text.', heading: 'Password reset' },
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('Password reset\n\nBody text.');
    expect(chunks[0]?.metadata).toEqual({ heading: 'Password reset' });
  });

  it('splits long sections with overlap and prepends the heading mid-section', () => {
    const blocks: RawBlock[] = [
      { text: 'Password reset', heading: 'Password reset' },
      ...Array.from({ length: 20 }, (_, index) => ({
        text: `para${index} ${words(99)}`,
        heading: 'Password reset',
      })),
    ];

    const chunks = chunkBlocks(blocks);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // +10 slack: a prepended heading is added after the token budget.
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS + 10);
      expect(chunk.metadata.heading).toBe('Password reset');
    }
    // every chunk after the first starts mid-section → heading as context
    for (const chunk of chunks.slice(1)) {
      expect(chunk.content.startsWith('Password reset\n\n')).toBe(true);
    }
    // the second chunk opens with the overlap from the first chunk's tail
    expect(chunks[1]?.content).toContain('para5 ');
    expect(chunks[1]?.content).not.toContain('para4 ');
  });

  it('keeps pages in separate chunks and carries overlap across the boundary', () => {
    const blocks: RawBlock[] = Array.from({ length: 5 }, (_, index) => ({
      text: `p1u${index} ${words(99)}`,
      page: 1,
    }));
    blocks.push({ text: `p2u0 ${words(99)}`, page: 2 }, { text: `p2u1 ${words(99)}`, page: 2 });

    const chunks = chunkBlocks(blocks);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.metadata.page).toBe(1);
    expect(chunks[1]?.metadata.page).toBe(2);
    expect(chunks[0]?.content).not.toContain('p2u');
    // overlap = the last unit of page 1 (100-token budget)
    expect(chunks[1]?.content.startsWith(`p1u4 ${words(99)}`)).toBe(true);
    expect(chunks[1]?.content).toContain('p2u1 ');
  });

  it('merges a small trailing chunk into its predecessor', () => {
    const chunks = chunkBlocks([
      { text: `big0 ${words(699)}` },
      { text: `big1 ${words(699)}` },
      { text: 'Short tail.' },
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.content).toContain('Short tail.');
  });

  it('hard-wraps a sentence that alone exceeds the budget', () => {
    const chunks = chunkBlocks([{ text: words(1200) }]);

    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TARGET_TOKENS);
    }
  });

  it('keeps page metadata for page-only chunks', () => {
    expect(chunkBlocks([{ text: 'Only page.', page: 7 }])).toEqual([
      { content: 'Only page.', tokenCount: 2, metadata: { page: 7 } },
    ]);
  });
});
