import { readFile } from 'node:fs/promises';

import { parseDocument } from './index';

/**
 * Standalone parse entry — spawned by `ChildProcessParseRunner`, never loaded
 * by application code. Reads one stored file, prints exactly one JSON message
 * (`{ ok: true, blocks }` or `{ ok: false, error }`) and lets Node exit
 * naturally so the pipe flushes. The parent kills this process when it exceeds
 * its memory/time/output budgets, so a decompression bomb dies here instead of
 * taking the API down (final audit HIGH ×2).
 */
async function main(): Promise<void> {
  const [filePath, mimeType] = process.argv.slice(2);
  if (!filePath || !mimeType) {
    throw new Error('usage: parse-child <file> <mime-type>');
  }

  const buffer = await readFile(filePath);
  const blocks = await parseDocument(buffer, mimeType);
  process.stdout.write(JSON.stringify({ ok: true, blocks }));
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
  });
}
