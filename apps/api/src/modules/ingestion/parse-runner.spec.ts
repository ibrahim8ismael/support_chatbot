import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InProcessParseRunner } from './in-process-parse-runner';
import { ChildProcessParseRunner, readProcessRssBytes } from './parse-runner';

/**
 * The child-process budgets are the last line against decompression bombs, so
 * every way a child can go wrong is pinned here with tiny fixture scripts.
 */
let dir: string;
let scriptCount = 0;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'parse-runner-'));
  scriptCount = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeScript(source: string): Promise<string> {
  scriptCount += 1;
  const scriptPath = path.join(dir, `child-${scriptCount}.js`);
  await writeFile(scriptPath, source);
  return scriptPath;
}

describe('InProcessParseRunner', () => {
  it('parses a stored text file', async () => {
    const filePath = path.join(dir, 'doc.txt');
    await writeFile(filePath, 'hello world');

    await expect(new InProcessParseRunner().parse(filePath, 'text/plain')).resolves.toEqual([
      { text: 'hello world' },
    ]);
  });
});

describe('ChildProcessParseRunner', () => {
  it('returns the blocks the child printed', async () => {
    const script = await writeScript(
      `process.stdout.write(JSON.stringify({ ok: true, blocks: [{ text: 'hello' }] }));`,
    );
    const runner = new ChildProcessParseRunner(script);

    await expect(runner.parse('/tmp/ignored', 'text/plain')).resolves.toEqual([{ text: 'hello' }]);
  });

  it('propagates a structured parse error so the document fails readably', async () => {
    const script = await writeScript(
      `process.stdout.write(JSON.stringify({ ok: false, error: 'no parser for mime type "application/zip"' }));`,
    );
    const runner = new ChildProcessParseRunner(script);

    await expect(runner.parse('/tmp/ignored', 'application/zip')).rejects.toThrow(
      /no parser for mime type/,
    );
  });

  it('reports a crashed child with its stderr tail', async () => {
    const script = await writeScript(
      `process.stderr.write('parser died mid-inflate'); process.exitCode = 3;`,
    );
    const runner = new ChildProcessParseRunner(script);

    await expect(runner.parse('/tmp/ignored', 'application/pdf')).rejects.toThrow(
      /exited with code 3: parser died mid-inflate/,
    );
  });

  it('rejects unreadable child output', async () => {
    const script = await writeScript(`process.stdout.write('not json');`);
    const runner = new ChildProcessParseRunner(script);

    await expect(runner.parse('/tmp/ignored', 'text/plain')).rejects.toThrow(/unreadable output/);
  });

  it('kills a child that exceeds the memory budget (decompression bomb)', async () => {
    // Budget below any Node baseline RSS: deterministic on every platform and
    // exercises the real /proc // ps probe plus the SIGKILL path. (A child that
    // *grows* memory is covered by the manual bomb reproductions; macOS
    // compresses idle pages, so a grow-then-sleep fixture is not portable.)
    const script = await writeScript(`setInterval(() => {}, 1000);`);
    const runner = new ChildProcessParseRunner(script, {
      memoryLimitBytes: 16 * 1024 * 1024,
      pollIntervalMs: 25,
      timeoutMs: 15_000,
    });

    await expect(runner.parse('/tmp/ignored', 'application/pdf')).rejects.toThrow(/memory budget/);
  });

  it('reads the resident set of a live process', async () => {
    await expect(readProcessRssBytes(process.pid)).resolves.toBeGreaterThan(16 * 1024 * 1024);
  });

  it('kills a child that exceeds the output budget', async () => {
    const script = await writeScript(`process.stdout.write(Buffer.alloc(128 * 1024, 120));`);
    const runner = new ChildProcessParseRunner(script, { outputLimitBytes: 64 * 1024 });

    await expect(runner.parse('/tmp/ignored', 'text/plain')).rejects.toThrow(/of output/);
  });

  it('kills a child that exceeds the time budget', async () => {
    const script = await writeScript(`setInterval(() => {}, 1000);`);
    const runner = new ChildProcessParseRunner(script, { timeoutMs: 300 });

    await expect(runner.parse('/tmp/ignored', 'application/pdf')).rejects.toThrow(/timed out/);
  });
});
