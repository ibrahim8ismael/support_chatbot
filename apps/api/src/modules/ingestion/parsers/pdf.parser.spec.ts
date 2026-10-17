import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { parsePdf } from './pdf.parser';

// Vitest runs with the package as cwd (turbo → `pnpm test` inside apps/api).
const FIXTURE = path.join(process.cwd(), 'test/fixtures/reset-guide.pdf');

describe('parsePdf', () => {
  it('extracts one block per page, keeping page numbers and edge lines', async () => {
    const blocks = await parsePdf(await readFile(FIXTURE));

    expect(blocks).toHaveLength(3);
    expect(blocks.map((block) => block.page)).toEqual([1, 2, 3]);
    expect(blocks[0]?.text).toContain('How do I reset my password?');
    expect(blocks[1]?.text).toContain('Standard delivery takes three to five business days.');
    expect(blocks[2]?.text).toContain('Email support@acme.example');
    // Running header/footer are still present — the cleaner strips them.
    for (const block of blocks) {
      expect(block.text).toContain('ACME Support Handbook');
      expect(block.text).toContain('Internal - do not share');
    }
  });

  it('rejects input that is not a PDF', async () => {
    // pdfjs logs a warning while rebuilding the xref of a broken file.
    const mute = [vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'log')];
    mute.forEach((spy) => spy.mockImplementation(() => undefined));
    try {
      await expect(parsePdf(Buffer.from('definitely not a pdf'))).rejects.toThrow();
    } finally {
      mute.forEach((spy) => spy.mockRestore());
    }
  });
});
