import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { RawBlock } from './parsers/types';

const execFileAsync = promisify(execFile);

/**
 * Parse-time budgets (final audit HIGH ×2): a crafted DOCX/PDF can inflate to
 * gigabytes *before* any text-level cap can see it (zip/flate bombs), and the
 * burst happens inside the parser library. Parsing therefore runs in a child
 * process the API supervises: the parent kills it on any budget overrun, so
 * the worst case is a failed document — never a dead (or OOM-killed) API.
 */
export const MAX_PARSE_CHILD_RSS_BYTES = 512 * 1024 * 1024;
export const PARSE_CHILD_TIMEOUT_MS = 120_000;
export const MAX_PARSE_OUTPUT_BYTES = 32 * 1024 * 1024;
/** How often the parent checks the child's resident set while it parses. */
const RSS_POLL_INTERVAL_MS = 200;
/** Diagnostics kept from a dying child's stderr. */
const STDERR_TAIL_BYTES = 4 * 1024;

/** Parses one stored file. Production isolates; tests run in-process. */
export abstract class ParseRunner {
  abstract parse(filePath: string, mimeType: string): Promise<RawBlock[]>;
}

export interface ChildProcessParseRunnerOptions {
  memoryLimitBytes?: number;
  timeoutMs?: number;
  outputLimitBytes?: number;
  pollIntervalMs?: number;
}

interface ChildMessage {
  ok?: unknown;
  blocks?: unknown;
  error?: unknown;
}

/**
 * Spawns `parse-child.js` once per document with the stored path + sniffed mime
 * and reads back exactly one JSON message. The parent owns every budget: RSS
 * polling catches decompression bombs (the child never holds input-derived
 * memory the parent has not budgeted), the wall-clock timeout catches
 * pathologies memory cannot see, and the stdout cap catches oversized
 * extractions before they reach the chunker.
 */
export class ChildProcessParseRunner extends ParseRunner {
  private readonly memoryLimitBytes: number;
  private readonly timeoutMs: number;
  private readonly outputLimitBytes: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly childScriptPath: string = resolveChildScript(),
    options: ChildProcessParseRunnerOptions = {},
  ) {
    super();
    this.memoryLimitBytes = options.memoryLimitBytes ?? MAX_PARSE_CHILD_RSS_BYTES;
    this.timeoutMs = options.timeoutMs ?? PARSE_CHILD_TIMEOUT_MS;
    this.outputLimitBytes = options.outputLimitBytes ?? MAX_PARSE_OUTPUT_BYTES;
    this.pollIntervalMs = options.pollIntervalMs ?? RSS_POLL_INTERVAL_MS;
  }

  async parse(filePath: string, mimeType: string): Promise<RawBlock[]> {
    return new Promise<RawBlock[]>((resolve, reject) => {
      const child = spawn(process.execPath, [this.childScriptPath, filePath, mimeType], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let rssCheckRunning = false;

      const finish = (error?: Error, blocks?: RawBlock[]): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearInterval(watchdog);
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve(blocks ?? []);
        }
      };

      /** SIGKILL: the child may be parked inside a synchronous inflate loop. */
      const abort = (message: string): void => {
        if (settled) {
          return;
        }
        child.kill('SIGKILL');
        finish(new Error(message));
      };

      const stderrTail = (): string => {
        const tail = Buffer.concat(stderr).toString('utf8').trim().replace(/\s+/g, ' ');
        return tail === '' ? '' : `: ${tail.slice(0, 300)}`;
      };

      const watchdog = setInterval(() => {
        if (settled || rssCheckRunning) {
          return;
        }
        rssCheckRunning = true;
        void readProcessRssBytes(child.pid)
          .then((rssBytes) => {
            if (rssBytes !== null && rssBytes > this.memoryLimitBytes) {
              abort(
                `document parsing exceeded its ${formatBytes(this.memoryLimitBytes)} memory budget — the file inflates far beyond its download size and cannot be processed safely`,
              );
            }
          })
          .finally(() => {
            rssCheckRunning = false;
          });
      }, this.pollIntervalMs);

      const timeout = setTimeout(() => {
        abort(`document parsing timed out after ${Math.round(this.timeoutMs / 1000)} s`);
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (settled) {
          return;
        }
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > this.outputLimitBytes) {
          abort(
            `document parsing produced more than ${formatBytes(this.outputLimitBytes)} of output — the file is too large to index`,
          );
          return;
        }
        stdout.push(chunk);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes <= STDERR_TAIL_BYTES) {
          stderr.push(chunk);
        }
      });

      child.on('error', (error) => {
        finish(new Error(`document parser could not start: ${error.message}`));
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        if (code !== 0) {
          finish(new Error(`document parser exited with code ${String(code)}${stderrTail()}`));
          return;
        }

        let message: ChildMessage;
        try {
          message = JSON.parse(Buffer.concat(stdout).toString('utf8')) as ChildMessage;
        } catch {
          finish(new Error(`document parser produced unreadable output${stderrTail()}`));
          return;
        }

        if (message.ok === true && Array.isArray(message.blocks)) {
          finish(undefined, message.blocks as RawBlock[]);
          return;
        }
        if (message.ok === false && typeof message.error === 'string') {
          finish(new Error(message.error));
          return;
        }
        finish(new Error(`document parser produced an unexpected message${stderrTail()}`));
      });
    });
  }
}

/**
 * `/proc` on Linux (production; exact), `ps` elsewhere. `null` means
 * "unreadable", not "zero". macOS compresses idle pages, so a child that has
 * stopped allocating can read lower than it holds; the budget matters while
 * parsing is actively inflating memory — exactly when this probe runs.
 */
export async function readProcessRssBytes(pid: number | undefined): Promise<number | null> {
  if (pid === undefined) {
    return null;
  }
  try {
    if (process.platform === 'linux') {
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
      return match ? Number(match[1]) * 1024 : null;
    }
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)]);
    const kib = Number.parseInt(String(stdout).trim(), 10);
    return Number.isFinite(kib) ? kib * 1024 : null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round(bytes / (1024 * 1024))} MiB`
    : `${Math.round(bytes / 1024)} KiB`;
}

/** Compiled sibling (`dist/.../parsers/parse-child.js`); Nest copies src 1:1. */
function resolveChildScript(): string {
  return path.join(__dirname, 'parsers', 'parse-child.js');
}
