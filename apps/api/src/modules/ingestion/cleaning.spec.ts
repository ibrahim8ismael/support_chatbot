import { describe, expect, it } from 'vitest';

import { cleanBlocks, normalizeText } from './cleaning';

const page = (number: number, body: string): { text: string; page: number } => ({
  text: `ACME Handbook\n${body}\nInternal - do not share`,
  page: number,
});

describe('normalizeText', () => {
  it('collapses whitespace, fixes hyphenation, and bounds blank lines', () => {
    expect(normalizeText('pass-\nword here\r\n\r\n\r\n\r\nnext\tline')).toBe(
      'password here\n\nnext line',
    );
  });

  it('keeps a hyphen when the next line starts a new word', () => {
    expect(normalizeText('mid-\nWord')).toBe('mid-\nWord');
  });
});

describe('cleanBlocks', () => {
  it('strips repeated first/last lines on documents with 3+ pages', () => {
    const cleaned = cleanBlocks([page(1, 'One'), page(2, 'Two'), page(3, 'Three')]);

    expect(cleaned.map((block) => block.text)).toEqual(['One', 'Two', 'Three']);
  });

  it('keeps edges on short documents (nothing looks like boilerplate)', () => {
    const cleaned = cleanBlocks([page(1, 'One'), page(2, 'Two')]);

    expect(cleaned[0]?.text).toBe('ACME Handbook\nOne\nInternal - do not share');
  });

  it('keeps edge lines that are not repeated across pages', () => {
    const cleaned = cleanBlocks([
      { text: 'Header\nOne\nFooter A', page: 1 },
      { text: 'Header\nTwo\nFooter B', page: 2 },
      { text: 'Header\nThree\nFooter C', page: 3 },
    ]);

    expect(cleaned.map((block) => block.text)).toEqual([
      'One\nFooter A',
      'Two\nFooter B',
      'Three\nFooter C',
    ]);
  });

  it('normalizes blocks without a page and drops empty ones', () => {
    const cleaned = cleanBlocks([
      { text: 'Heading', heading: 'Heading' },
      { text: '  spaced   out\ttext \n\n\nnext ', heading: 'Heading' },
      { text: ' \n ', heading: 'Heading' },
    ]);

    expect(cleaned).toEqual([
      { text: 'Heading', heading: 'Heading' },
      { text: 'spaced out text\n\nnext', heading: 'Heading' },
    ]);
  });
});
