import { readFile } from 'node:fs/promises';

import { ParseRunner } from './parse-runner';
import { parseDocument } from './parsers';
import type { RawBlock } from './parsers/types';

/**
 * In-process parsing — tests only. Production wires `ChildProcessParseRunner`
 * so parser memory (and any decompression bomb) never lives in the API process.
 */
export class InProcessParseRunner extends ParseRunner {
  async parse(filePath: string, mimeType: string): Promise<RawBlock[]> {
    const buffer = await readFile(filePath);
    return parseDocument(buffer, mimeType);
  }
}
