import mammoth from 'mammoth';

import type { RawBlock } from './types';

/**
 * DOCX via mammoth → HTML (the one format that keeps Word's outline), then a
 * tiny block walker: `h1–h6` become headings, `p`/`li` become paragraphs that
 * remember the heading above them. DOCX has no pages, so blocks carry none.
 */
export async function parseDocx(buffer: Buffer): Promise<RawBlock[]> {
  const { value } = await mammoth.convertToHtml({ buffer });
  return htmlToBlocks(value);
}

const BLOCK_PATTERN = /<(h[1-6]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;

/** Exported for tests; tolerant of the simple HTML mammoth emits. */
export function htmlToBlocks(html: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let heading: string | undefined;

  for (const match of html.matchAll(BLOCK_PATTERN)) {
    const tag = (match[1] ?? '').toLowerCase();
    const text = decodeEntities((match[2] ?? '').replace(/<[^>]*>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      heading = text;
      blocks.push({ text, heading });
    } else {
      blocks.push({ text, heading });
    }
  }

  return blocks;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
