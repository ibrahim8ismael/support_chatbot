import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { htmlToBlocks, parseDocx } from './docx.parser';

const FIXTURE = path.join(process.cwd(), 'test/fixtures/reset-guide.docx');

describe('parseDocx', () => {
  it('keeps heading structure around paragraphs', async () => {
    const blocks = await parseDocx(await readFile(FIXTURE));

    expect(blocks.map((block) => [block.text, block.heading])).toEqual([
      ['Password reset', 'Password reset'],
      ['Open Settings, then Security, and choose Reset password.', 'Password reset'],
      ['You will receive a reset link by email within a few minutes.', 'Password reset'],
      ['Delivery times', 'Delivery times'],
      ['Standard delivery takes three to five business days.', 'Delivery times'],
      ['Express delivery arrives within one business day.', 'Delivery times'],
    ]);
  });
});

describe('htmlToBlocks', () => {
  it('decodes entities, strips inline markup, and tracks headings', () => {
    expect(
      htmlToBlocks(
        '<h2>A &amp; B</h2><p>Use <strong>settings</strong>&nbsp;now</p><ul><li>One</li></ul>',
      ),
    ).toEqual([
      { text: 'A & B', heading: 'A & B' },
      { text: 'Use settings now', heading: 'A & B' },
      { text: 'One', heading: 'A & B' },
    ]);
  });

  it('returns nothing for empty markup', () => {
    expect(htmlToBlocks('<p> </p>')).toEqual([]);
  });
});
