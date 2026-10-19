import path from 'node:path';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

import type { RawBlock } from './types';

/**
 * Page-loop guard: a crafted PDF with a huge page count is the main in-process
 * parsing bomb vector, and pdfjs walks pages sequentially.
 */
export const MAX_PDF_PAGES = 500;

/**
 * pdfjs v6 is ESM-only; the CJS build loads it through Node's `require(esm)`
 * (Node ≥ 22.12 — pinned by the Docker images and CI). The legacy build is the
 * supported Node entry point, and no worker/rendering is involved: we only
 * pull the text layer.
 *
 * One block per page (keeping `page` metadata for the chunker); running
 * headers/footers are removed later by the cleaner.
 */
export async function parsePdf(buffer: Buffer): Promise<RawBlock[]> {
  const task = getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: standardFontDataUrl(),
    useWorkerFetch: false,
    useSystemFonts: false,
  });

  try {
    const document = await task.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`PDF has ${document.numPages} pages — the limit is ${MAX_PDF_PAGES}`);
    }
    const blocks: RawBlock[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();

      const lines: string[] = [];
      let current = '';
      for (const item of content.items) {
        if (!('str' in item)) {
          continue;
        }
        current += item.str;
        if (item.hasEOL) {
          lines.push(current);
          current = '';
        }
      }
      if (current) {
        lines.push(current);
      }

      const text = lines.join('\n').trim();
      if (text) {
        blocks.push({ text, page: pageNumber });
      }
      page.cleanup();
    }

    return blocks;
  } finally {
    await task.destroy();
  }
}

/** pdfjs wants bundled font data for some pages; harmless when unresolvable. */
function standardFontDataUrl(): string | undefined {
  try {
    return path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');
  } catch {
    return undefined;
  }
}
