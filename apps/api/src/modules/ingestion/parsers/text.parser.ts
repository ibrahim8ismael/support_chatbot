import type { RawBlock } from './types';

/**
 * TXT and Markdown: paragraphs split on blank lines. In Markdown, `#`-style
 * headings become block headings so the chunker can keep sections together.
 * The heading line itself is a block, so headings survive as retrievable text.
 */
export function parseText(input: string, options: { markdown?: boolean } = {}): RawBlock[] {
  const blocks: RawBlock[] = [];
  let heading: string | undefined;
  let paragraph: string[] = [];

  const flush = (): void => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (text) {
      blocks.push({ text, heading });
    }
  };

  for (const line of input.split(/\r?\n/)) {
    if (options.markdown) {
      const match = /^#{1,6}\s+(.*)$/.exec(line);
      if (match) {
        flush();
        heading = (match[1] ?? '').trim();
        if (heading) {
          blocks.push({ text: heading, heading });
        }
        continue;
      }
    }

    if (line.trim() === '') {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return blocks;
}
