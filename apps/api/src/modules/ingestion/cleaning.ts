import type { RawBlock } from './parsers/types';

/**
 * Clean parsed text before chunking (pipeline doc step 3): strip repeated
 * page headers/footers, fix hyphenation and whitespace, drop empty lines.
 * The document's own structure (headings, page numbers) is preserved.
 */
export function cleanBlocks(blocks: RawBlock[]): RawBlock[] {
  const pageCount = blocks.filter((block) => block.page !== undefined).length;
  const withoutBoilerplate = pageCount >= 3 ? stripRepeatedPageEdges(blocks) : blocks;

  return withoutBoilerplate
    .map((block) => ({ ...block, text: normalizeText(block.text) }))
    .filter((block) => block.text.length > 0);
}

/**
 * Running headers/footers repeat at the page edges. A line that leads or
 * trails at least 60% of pages (and at least 3 of them) is boilerplate, not
 * content — docs shorter than 3 pages never lose anything. Blocks without a
 * page (DOCX/Markdown) pass through untouched.
 */
function stripRepeatedPageEdges(blocks: RawBlock[]): RawBlock[] {
  const pages = blocks.filter((block) => block.page !== undefined);
  const edgeCounts = new Map<string, number>();
  for (const block of pages) {
    for (const edge of pageEdges(block.text)) {
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const boilerplate = new Set(
    [...edgeCounts.entries()].filter(([, count]) => count >= threshold).map(([line]) => line),
  );
  if (boilerplate.size === 0) {
    return blocks;
  }

  return blocks.map((block) => {
    if (block.page === undefined) {
      return block;
    }
    const lines = splitLines(block.text);
    const kept = lines.filter((line, index) => {
      const isFirst = index === 0;
      const isLast = index === lines.length - 1;
      return !((isFirst || isLast) && boilerplate.has(line));
    });
    return { ...block, text: kept.join('\n') };
  });
}

function pageEdges(text: string): string[] {
  const lines = splitLines(text);
  const first = lines[0];
  const last = lines.length > 1 ? lines[lines.length - 1] : undefined;
  return [first, last].filter((line): line is string => Boolean(line));
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Whitespace normalization + de-hyphenation across line breaks. */
export function normalizeText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim());

  return (
    lines
      .join('\n')
      // "pass-\nword" → "password" (only when the word continues lowercase)
      .replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
