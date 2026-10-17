import { describe, expect, it } from 'vitest';

import { guardReply } from './reply-guard';

const BASE = {
  maxChars: 800,
  filenames: ['reset-guide.pdf'],
  chunkContents: ['Visit https://support.acme.example for help.'],
};

describe('guardReply', () => {
  it('passes clean replies through and trims them', () => {
    expect(guardReply({ ...BASE, reply: '  Reset it in Settings.  ' })).toEqual({
      ok: true,
      reply: 'Reset it in Settings.',
    });
  });

  it('rejects empty replies', () => {
    expect(guardReply({ ...BASE, reply: '   ' })).toMatchObject({ ok: false });
  });

  it('rejects replies that mention internals', () => {
    const result = guardReply({ ...BASE, reply: 'According to the knowledge base, ...' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/internals/);
    }
  });

  it('rejects replies that cite a document filename', () => {
    expect(guardReply({ ...BASE, reply: 'See reset-guide.pdf for details.' })).toMatchObject({
      ok: false,
    });
  });

  it('rejects URLs that are not in the knowledge', () => {
    const result = guardReply({ ...BASE, reply: 'Open https://evil.example/reset and continue.' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/URL/);
    }
  });

  it('allows URLs copied from the knowledge', () => {
    expect(guardReply({ ...BASE, reply: 'Open https://support.acme.example for help.' })).toEqual({
      ok: true,
      reply: 'Open https://support.acme.example for help.',
    });
  });

  it('caps long replies at maxChars on a word boundary', () => {
    const result = guardReply({ ...BASE, maxChars: 100, reply: `${'word '.repeat(300)}end` });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reply.length).toBeLessThanOrEqual(100);
      expect(result.reply.endsWith('…')).toBe(true);
    }
  });
});
