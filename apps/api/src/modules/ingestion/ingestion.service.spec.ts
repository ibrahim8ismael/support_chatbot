import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMBEDDING_DIMENSIONS, kbVersionKey } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { DatabaseService } from '../../db/database.service';
import type { CacheService } from '../infra/cache.service';
import type {
  IngestionDocument,
  KnowledgeBaseService,
} from '../knowledge-base/knowledge-base.service';
import type { LlmService } from '../llm/llm.service';
import { chunks } from './entities/chunk.entity';
import { InProcessParseRunner } from './in-process-parse-runner';
import { IngestionService } from './ingestion.service';
import { DOCX_MIME_TYPE } from './parsers';

const KB_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

const FIXTURES = path.join(process.cwd(), 'test/fixtures');
const PDF_FIXTURE = path.join(FIXTURES, 'reset-guide.pdf');
const DOCX_FIXTURE = path.join(FIXTURES, 'reset-guide.docx');

function documentRow(overrides: Partial<IngestionDocument> = {}): IngestionDocument {
  return {
    id: DOC_ID,
    kbId: KB_ID,
    sourceType: 'upload',
    filename: 'reset-guide.pdf',
    mimeType: 'application/pdf',
    storagePath: 'stored.pdf',
    status: 'processing',
    chunkCount: 0,
    contentHash: 'a'.repeat(64),
    ...overrides,
  };
}

function buildHarness(options: { document?: IngestionDocument | null } = {}) {
  const insertedRows: Array<Record<string, unknown>> = [];
  const deletedTables: unknown[] = [];

  const tx = {
    execute: vi.fn(async () => []),
    delete: vi.fn((table: unknown) => ({
      where: vi.fn(async () => {
        deletedTables.push(table);
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (rows: Array<Record<string, unknown>>) => {
        void table;
        insertedRows.push(...rows);
      }),
    })),
  };
  const transaction = vi.fn(async (run: (txLike: typeof tx) => Promise<void>) => run(tx));

  const database = { db: { transaction } } as unknown as DatabaseService;

  const document = options.document === undefined ? documentRow() : options.document;
  const knowledgeBase = {
    getIngestionDocument: vi.fn(async () => document),
    markDocumentReady: vi.fn(async () => undefined),
    markDocumentFailed: vi.fn(async () => undefined),
  } as unknown as KnowledgeBaseService;

  const embedCalls: number[] = [];
  const embed = vi.fn(async (texts: string[]) => {
    embedCalls.push(texts.length);
    return {
      embeddings: texts.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0.01)),
    };
  });
  const llm = { embed } as unknown as LlmService;

  const incr = vi.fn(async () => undefined);
  const cache = { incr } as unknown as CacheService;

  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;

  const config = {
    get: vi.fn((key: string) => (key === 'UPLOAD_DIR' ? uploadDir : undefined)),
  } as unknown as ConfigService;

  const service = new IngestionService(
    database,
    knowledgeBase,
    llm,
    cache,
    logger,
    new InProcessParseRunner(),
    config,
  );

  return {
    service,
    knowledgeBase,
    embed,
    embedCalls,
    incr,
    tx,
    transaction,
    insertedRows,
    deletedTables,
    logger,
  };
}

let uploadDir: string;

beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'ingest-'));
});

afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

async function storeFixture(fixture: string, storagePath: string): Promise<void> {
  await writeFile(path.join(uploadDir, storagePath), await readFile(fixture));
}

describe('IngestionService.ingest', () => {
  it('runs parse → clean → chunk → embed → replace for a PDF fixture', async () => {
    await storeFixture(PDF_FIXTURE, 'stored.pdf');
    const { service, knowledgeBase, incr, insertedRows, deletedTables, transaction, tx } =
      buildHarness();

    await expect(service.ingest(DOC_ID)).resolves.toBe('ingested');

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(1); // advisory lock
    expect(deletedTables).toEqual([chunks]);

    expect(insertedRows).toHaveLength(1);
    const row = insertedRows[0];
    expect(row).toMatchObject({ kbId: KB_ID, documentId: DOC_ID, chunkIndex: 0 });
    expect(String(row?.content)).toContain('How do I reset my password?');
    expect(String(row?.content)).toContain('Email support@acme.example');
    // repeated header/footer lines were cleaned away
    expect(String(row?.content)).not.toContain('ACME Support Handbook');
    expect(String(row?.content)).not.toContain('Internal - do not share');
    expect(row?.metadata).toEqual({ page: 1 });
    expect((row?.embedding as number[]).length).toBe(EMBEDDING_DIMENSIONS);

    expect(knowledgeBase.markDocumentReady).toHaveBeenCalledWith(DOC_ID, 1);
    expect(incr).toHaveBeenCalledWith(kbVersionKey(KB_ID));
  });

  it('ingests a DOCX fixture keeping heading context', async () => {
    await storeFixture(DOCX_FIXTURE, 'stored.docx');
    const { service, insertedRows } = buildHarness({
      document: documentRow({
        mimeType: DOCX_MIME_TYPE,
        storagePath: 'stored.docx',
        filename: 'reset-guide.docx',
      }),
    });

    await expect(service.ingest(DOC_ID)).resolves.toBe('ingested');

    expect(insertedRows).toHaveLength(1);
    expect(String(insertedRows[0]?.content)).toContain('Password reset');
    expect(String(insertedRows[0]?.content)).toContain('Delivery times');
    expect(insertedRows[0]?.metadata).toEqual({ heading: 'Password reset' });
  });

  it('skips a document that is already ingested (at-least-once delivery)', async () => {
    const { service, embed, transaction } = buildHarness({
      document: documentRow({ status: 'ready', chunkCount: 3 }),
    });

    await expect(service.ingest(DOC_ID)).resolves.toBe('skipped');
    expect(embed).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('skips a document that was deleted mid-flight', async () => {
    const { service, embed } = buildHarness({ document: null });

    await expect(service.ingest(DOC_ID)).resolves.toBe('skipped');
    expect(embed).not.toHaveBeenCalled();
  });

  it('fails readably when there is no stored file', async () => {
    const { service } = buildHarness({ document: documentRow({ storagePath: null }) });

    await expect(service.ingest(DOC_ID)).rejects.toThrow(/no stored file/);
  });

  it('rejects storage paths outside UPLOAD_DIR', async () => {
    const { service } = buildHarness({
      document: documentRow({ storagePath: '../escape.pdf' }),
    });

    await expect(service.ingest(DOC_ID)).rejects.toThrow(/escapes UPLOAD_DIR/);
  });

  it('fails when the document has no extractable text', async () => {
    await writeFile(path.join(uploadDir, 'empty.txt'), '   \n\n');
    const { service } = buildHarness({
      document: documentRow({ storagePath: 'empty.txt', mimeType: 'text/plain' }),
    });

    await expect(service.ingest(DOC_ID)).rejects.toThrow(/no extractable text/);
  });

  it('fails for mime types without a parser', async () => {
    await writeFile(path.join(uploadDir, 'file.bin'), 'binary');
    const { service } = buildHarness({
      document: documentRow({ storagePath: 'file.bin', mimeType: 'application/zip' }),
    });

    await expect(service.ingest(DOC_ID)).rejects.toThrow(/no parser/);
  });

  it('embeds in provider-sized batches', async () => {
    const paragraph = Array.from({ length: 700 }, (_, index) => `w${index}`).join(' ');
    const content = Array.from({ length: 110 }, () => paragraph).join('\n\n');
    await writeFile(path.join(uploadDir, 'big.txt'), content);

    const { service, embedCalls, insertedRows } = buildHarness({
      document: documentRow({ storagePath: 'big.txt', mimeType: 'text/plain' }),
    });

    await expect(service.ingest(DOC_ID)).resolves.toBe('ingested');

    expect(embedCalls).toEqual([100, 10]);
    expect(insertedRows).toHaveLength(110);
    expect(insertedRows[109]).toMatchObject({ chunkIndex: 109 });
  });

  it('retries a flaky embedding provider before giving up', async () => {
    await storeFixture(PDF_FIXTURE, 'stored.pdf');
    const { service, embed } = buildHarness();
    let failures = 0;
    embed.mockImplementation(async (texts: string[]) => {
      if (failures < 2) {
        failures += 1;
        throw new Error('provider down');
      }
      return {
        embeddings: texts.map(() => new Array<number>(EMBEDDING_DIMENSIONS).fill(0.01)),
      };
    });

    await expect(service.ingest(DOC_ID)).resolves.toBe('ingested');
    expect(embed).toHaveBeenCalledTimes(3);
  });

  it('throws when the provider keeps failing (the worker sets the final state)', async () => {
    await storeFixture(PDF_FIXTURE, 'stored.pdf');
    const { service, embed, knowledgeBase } = buildHarness();
    embed.mockRejectedValue(new Error('provider down'));

    await expect(service.ingest(DOC_ID)).rejects.toThrow('provider down');
    expect(knowledgeBase.markDocumentReady).not.toHaveBeenCalled();
  });
});
