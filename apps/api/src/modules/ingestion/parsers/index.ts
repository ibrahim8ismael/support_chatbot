import type { RawBlock } from './types';

import { parseDocx } from './docx.parser';
import { parsePdf } from './pdf.parser';
import { parseText } from './text.parser';

export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Dispatch by the sniffed mime type (never the user-supplied filename). */
export async function parseDocument(buffer: Buffer, mimeType: string): Promise<RawBlock[]> {
  switch (mimeType) {
    case 'application/pdf':
      return parsePdf(buffer);
    case DOCX_MIME_TYPE:
      return parseDocx(buffer);
    case 'text/markdown':
      return parseText(buffer.toString('utf8'), { markdown: true });
    case 'text/plain':
      return parseText(buffer.toString('utf8'));
    default:
      throw new Error(`no parser for mime type "${mimeType}"`);
  }
}

export { parseDocx, parsePdf, parseText };
export type { RawBlock } from './types';
