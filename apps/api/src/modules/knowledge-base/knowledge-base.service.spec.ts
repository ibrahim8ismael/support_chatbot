import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  QUEUES,
  kbVersionKey,
  type DocumentSourceType,
  type DocumentStatus,
  type KbStatus,
} from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { DatabaseService } from '../../db/database.service';
import type { AnalyticsService } from '../analytics/analytics.service';
import type { BindingsService } from '../bindings/bindings.service';
import type { CacheService } from '../infra/cache.service';
import type { QueueService } from '../infra/queue.service';
import { contentHash } from './document-file';
import { documents } from './entities/document.entity';
import { knowledgeBases } from './entities/knowledge-base.entity';
import { KnowledgeBaseService, type UploadedDocumentFile } from './knowledge-base.service';

const KB_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_KB_ID = '99999999-9999-4999-8999-999999999999';
const DOC_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

interface KbRow {
  id: string;
  name: string;
  description: string | null;
  status: KbStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface DocumentRow {
  id: string;
  kbId: string;
  sourceType: DocumentSourceType;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string | null;
  status: DocumentStatus;
  error: string | null;
  chunkCount: number;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CountRow {
  kbId: string;
  status: DocumentStatus;
  total: number;
}

function kbRow(overrides: Partial<KbRow> = {}): KbRow {
  return {
    id: KB_ID,
    name: 'Support FAQ',
    description: null,
    status: 'active',
    createdBy: USER_ID,
    createdAt: new Date('2026-10-18T10:00:00Z'),
    updatedAt: new Date('2026-10-18T10:00:00Z'),
    ...overrides,
  };
}

function docRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOC_ID,
    kbId: KB_ID,
    sourceType: 'upload',
    filename: 'faq.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 14,
    storagePath: null,
    status: 'ready',
    error: null,
    chunkCount: 3,
    contentHash: 'a'.repeat(64),
    createdBy: USER_ID,
    createdAt: new Date('2026-10-18T10:01:00Z'),
    updatedAt: new Date('2026-10-18T10:01:00Z'),
    ...overrides,
  };
}

function buildHarness(
  fixtures: { kbRows?: KbRow[]; documentRows?: DocumentRow[]; countRows?: CountRow[] } = {},
  options: {
    uploadDir: string;
    bound?: boolean;
    emptyUpdateReturn?: boolean;
    /** Makes document inserts/updates fail with SQLSTATE 23505 (unique index). */
    uniqueViolation?: boolean;
  },
) {
  const kbRows = fixtures.kbRows ?? [];
  const documentRows = fixtures.documentRows ?? [];
  const countRows = fixtures.countRows ?? [];

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => {
      if (table === knowledgeBases) {
        return {
          where: vi.fn(() => ({ limit: vi.fn(async () => kbRows.slice(0, 1)) })),
          orderBy: vi.fn(async () => kbRows),
        };
      }
      // documents: `.where()` is awaitable for plain reads, and chains for
      // limit/orderBy/groupBy just like the Drizzle builder.
      return {
        where: vi.fn(() =>
          Object.assign(Promise.resolve(documentRows), {
            limit: vi.fn(async () => documentRows.slice(0, 1)),
            orderBy: vi.fn(() => ({ limit: vi.fn(async () => documentRows) })),
            groupBy: vi.fn(async () => countRows),
          }),
        ),
        groupBy: vi.fn(async () => countRows),
      };
    }),
  }));

  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const insert = vi.fn((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      inserted.push({ table, values });
      return {
        returning: vi.fn(async () => {
          if (options.uniqueViolation && table === documents) {
            throw uniqueViolationError();
          }
          return [table === knowledgeBases ? { ...kbRow(), ...values } : { ...docRow(), ...values }];
        }),
      };
    },
  }));

  const updated: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const update = vi.fn((table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      updated.push({ table, values });
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => {
            if (options.uniqueViolation) {
              throw uniqueViolationError();
            }
            return options.emptyUpdateReturn
              ? []
              : [{ ...(table === knowledgeBases ? kbRow() : docRow()), ...values }];
          }),
        })),
      };
    },
  }));

  const deleted: Array<{ table: unknown }> = [];
  const remove = vi.fn((table: unknown) => ({
    where: vi.fn(async () => {
      deleted.push({ table });
    }),
  }));

  const database = {
    db: { select, insert, update, delete: remove },
  } as unknown as DatabaseService;

  const enqueue = vi.fn(async (_queue: string, _job: string, _data: unknown) => 'job-1');
  const queue = { enqueue } as unknown as QueueService;

  const isKbBound = vi.fn(async () => options.bound ?? false);
  const bindings = { isKbBound } as unknown as BindingsService;

  const cacheDel = vi.fn(async () => undefined);
  const cacheIncr = vi.fn(async () => undefined);
  const cache = { del: cacheDel, incr: cacheIncr } as unknown as CacheService;

  const logger = { warn: vi.fn(), error: vi.fn() } as unknown as AppLogger;

  const recordAuditLog = vi.fn(async (_input: unknown) => undefined);
  const analytics = { recordAuditLog } as unknown as AnalyticsService;

  const config = {
    get: vi.fn((key: string) => (key === 'UPLOAD_DIR' ? options.uploadDir : undefined)),
  } as unknown as ConfigService;

  const service = new KnowledgeBaseService(
    database,
    queue,
    bindings,
    analytics,
    cache,
    logger,
    config,
  );

  return {
    service,
    inserted,
    updated,
    deleted,
    enqueue,
    isKbBound,
    cacheDel,
    cacheIncr,
    logger,
    recordAuditLog,
  };
}

function uniqueViolationError(): Error & { code: string } {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

let uploadDir: string;

beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(tmpdir(), 'kb-uploads-'));
});

afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

function pdfFile(content = '%PDF-1.7 fixture'): UploadedDocumentFile {
  const buffer = Buffer.from(content);
  return {
    originalname: 'Manual.PDF',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
  };
}

/** Upload rejections keep `message: 'Validation failed'`; reasons live in `details`. */
async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse() as { details?: Array<{ message?: string }> };
      return response.details?.[0]?.message ?? error.message;
    }
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('KnowledgeBaseService', () => {
  describe('list / getSummary', () => {
    it('returns KBs with document counts and status summaries', async () => {
      const { service } = buildHarness(
        {
          kbRows: [kbRow(), kbRow({ id: OTHER_KB_ID, name: 'Billing' })],
          countRows: [
            { kbId: KB_ID, status: 'ready', total: 2 },
            { kbId: KB_ID, status: 'failed', total: 1 },
          ],
        },
        { uploadDir },
      );

      const summaries = await service.list();

      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toMatchObject({
        name: 'Support FAQ',
        documentCount: 3,
        statusCounts: { processing: 0, ready: 2, failed: 1 },
      });
      expect(summaries[1]).toMatchObject({
        name: 'Billing',
        documentCount: 0,
        statusCounts: { processing: 0, ready: 0, failed: 0 },
      });
    });

    it('404s for a missing KB', async () => {
      const { service } = buildHarness({}, { uploadDir });

      await expect(service.getSummary(KB_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create / update', () => {
    it('creates with the current user as owner and audits it', async () => {
      const { service, inserted, recordAuditLog } = buildHarness({}, { uploadDir });

      const created = await service.create({ name: 'Docs', description: 'Guides' }, USER_ID);

      expect(inserted[0]?.values).toEqual({
        name: 'Docs',
        description: 'Guides',
        createdBy: USER_ID,
      });
      expect(created).toMatchObject({ name: 'Docs', description: 'Guides', status: 'active' });
      expect(created.createdAt).toBe('2026-10-18T10:00:00.000Z');
      expect(recordAuditLog).toHaveBeenCalledWith({
        userId: USER_ID,
        action: 'knowledge_base.create',
        entity: 'knowledge_base',
        entityId: KB_ID,
        data: { name: 'Docs' },
      });
    });

    it('applies only the provided patch fields and audits the change', async () => {
      const { service, updated, recordAuditLog } = buildHarness(
        { kbRows: [kbRow()] },
        { uploadDir },
      );

      const result = await service.update(KB_ID, { status: 'archived' }, USER_ID);

      expect(updated[0]?.values).toEqual({ status: 'archived' });
      expect(result.status).toBe('archived');
      expect(recordAuditLog).toHaveBeenCalledWith({
        userId: USER_ID,
        action: 'knowledge_base.update',
        entity: 'knowledge_base',
        entityId: KB_ID,
        data: { patch: { status: 'archived' } },
      });
    });

    it('404s when the KB disappeared before the update', async () => {
      const { service } = buildHarness(
        { kbRows: [kbRow()] },
        { uploadDir, emptyUpdateReturn: true },
      );

      await expect(service.update(KB_ID, { name: 'x' }, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a KB that is bound to an inbox', async () => {
      const { service, deleted, cacheDel, recordAuditLog } = buildHarness(
        { kbRows: [kbRow()] },
        { uploadDir, bound: true },
      );

      await expect(service.remove(KB_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(deleted).toHaveLength(0);
      expect(cacheDel).not.toHaveBeenCalled();
      expect(recordAuditLog).not.toHaveBeenCalled();
    });

    it('deletes the KB, drops the version counter, removes stored files and audits it', async () => {
      const stored = 'stored.pdf';
      await writeFile(path.join(uploadDir, stored), 'stale');
      const { service, deleted, cacheDel, recordAuditLog } = buildHarness(
        { kbRows: [kbRow()], documentRows: [docRow({ storagePath: stored })] },
        { uploadDir },
      );

      await service.remove(KB_ID, USER_ID);

      expect(deleted).toEqual([{ table: knowledgeBases }]);
      expect(cacheDel).toHaveBeenCalledWith(kbVersionKey(KB_ID));
      await expect(access(path.join(uploadDir, stored))).rejects.toThrow();
      expect(recordAuditLog).toHaveBeenCalledWith({
        userId: USER_ID,
        action: 'knowledge_base.delete',
        entity: 'knowledge_base',
        entityId: KB_ID,
        data: { name: 'Support FAQ' },
      });
    });
  });

  describe('listDocuments', () => {
    it('404s for a missing KB and maps rows to ISO-string DTOs', async () => {
      const missing = buildHarness({}, { uploadDir });
      await expect(missing.service.listDocuments(KB_ID)).rejects.toBeInstanceOf(NotFoundException);

      const { service } = buildHarness(
        { kbRows: [kbRow()], documentRows: [docRow()] },
        { uploadDir },
      );
      const docs = await service.listDocuments(KB_ID);
      expect(docs[0]).toMatchObject({
        id: DOC_ID,
        kbId: KB_ID,
        filename: 'faq.pdf',
        status: 'ready',
        chunkCount: 3,
        createdAt: '2026-10-18T10:01:00.000Z',
      });
    });
  });

  describe('uploadDocument', () => {
    it('stores the file, creates a processing row, enqueues ingestion and audits it', async () => {
      const { service, inserted, enqueue, recordAuditLog } = buildHarness(
        { kbRows: [kbRow()] },
        { uploadDir },
      );
      const file = pdfFile();

      const result = await service.uploadDocument(KB_ID, file, USER_ID);

      expect(result).toEqual({ documentId: DOC_ID, status: 'processing' });

      const docInsert = inserted.find((entry) => entry.table === documents);
      expect(docInsert?.values).toMatchObject({
        kbId: KB_ID,
        sourceType: 'upload',
        filename: 'Manual.PDF',
        mimeType: 'application/pdf',
        sizeBytes: file.size,
        status: 'processing',
        chunkCount: 0,
        createdBy: USER_ID,
        contentHash: contentHash(file.buffer),
      });
      expect(String(docInsert?.values.storagePath)).toMatch(/\.pdf$/);

      const written = await readdir(uploadDir);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatch(/\.pdf$/);

      expect(enqueue).toHaveBeenCalledWith(QUEUES.ingestDocument, 'ingest-document', {
        documentId: DOC_ID,
      });
      expect(recordAuditLog).toHaveBeenCalledWith({
        userId: USER_ID,
        action: 'document.upload',
        entity: 'document',
        entityId: DOC_ID,
        data: { kbId: KB_ID, filename: 'Manual.PDF', sizeBytes: file.size },
      });
    });

    it('404s for a missing KB before touching the disk', async () => {
      const { service, inserted } = buildHarness({}, { uploadDir });

      await expect(service.uploadDocument(KB_ID, pdfFile(), USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(inserted).toHaveLength(0);
    });

    it('rejects unsupported extensions and sniff-mismatched content', async () => {
      const { service, inserted } = buildHarness({ kbRows: [kbRow()] }, { uploadDir });

      await expect(
        rejectionMessage(() =>
          service.uploadDocument(KB_ID, { ...pdfFile(), originalname: 'notes.rtf' }, USER_ID),
        ),
      ).resolves.toMatch(/unsupported file type/);

      await expect(
        rejectionMessage(() =>
          service.uploadDocument(
            KB_ID,
            { ...pdfFile('not a pdf at all'), originalname: 'fake.pdf' },
            USER_ID,
          ),
        ),
      ).resolves.toMatch(/not a PDF/);

      expect(inserted).toHaveLength(0);
    });

    it('rejects empty uploads', async () => {
      const { service } = buildHarness({ kbRows: [kbRow()] }, { uploadDir });

      await expect(
        rejectionMessage(() =>
          service.uploadDocument(
            KB_ID,
            { originalname: 'empty.txt', mimetype: 'text/plain', size: 0, buffer: Buffer.alloc(0) },
            USER_ID,
          ),
        ),
      ).resolves.toMatch(/empty/);
    });

    it('409s on identical content already in the KB', async () => {
      const { service, inserted } = buildHarness(
        { kbRows: [kbRow()], documentRows: [docRow()] },
        { uploadDir },
      );

      await expect(service.uploadDocument(KB_ID, pdfFile(), USER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(inserted).toHaveLength(0);
    });

    it('409s when a concurrent upload wins the dedupe race (unique index)', async () => {
      const { service, inserted } = buildHarness(
        { kbRows: [kbRow()] },
        { uploadDir, uniqueViolation: true },
      );

      await expect(service.uploadDocument(KB_ID, pdfFile(), USER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(inserted).toHaveLength(1);
      // The losing upload cleans up its stored copy of the file.
      expect(await readdir(uploadDir)).toHaveLength(0);
    });

    it('marks the document failed when the queue is down but keeps the file', async () => {
      const { service, enqueue, updated } = buildHarness({ kbRows: [kbRow()] }, { uploadDir });
      enqueue.mockRejectedValueOnce(new Error('redis down'));

      await expect(service.uploadDocument(KB_ID, pdfFile(), USER_ID)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      expect(updated).toContainEqual({
        table: documents,
        values: {
          status: 'failed',
          error: 'ingestion could not be queued — retry reprocess',
        },
      });
      const written = await readdir(uploadDir);
      expect(written).toHaveLength(1);
    });
  });

  describe('reprocessDocument', () => {
    it('resets status/error/chunks, re-enqueues and audits it', async () => {
      const { service, updated, enqueue, recordAuditLog } = buildHarness(
        { documentRows: [docRow({ status: 'failed', error: 'parse error', chunkCount: 0 })] },
        { uploadDir },
      );

      const result = await service.reprocessDocument(DOC_ID, USER_ID);

      expect(updated).toContainEqual({
        table: documents,
        values: { status: 'processing', error: null, chunkCount: 0 },
      });
      expect(result.status).toBe('processing');
      expect(enqueue).toHaveBeenCalledWith(QUEUES.ingestDocument, 'ingest-document', {
        documentId: DOC_ID,
      });
      expect(recordAuditLog).toHaveBeenCalledWith({
        userId: USER_ID,
        action: 'document.reprocess',
        entity: 'document',
        entityId: DOC_ID,
        data: { kbId: KB_ID, filename: 'faq.pdf' },
      });
    });

    it('404s for a missing document', async () => {
      const { service } = buildHarness({}, { uploadDir });

      await expect(service.reprocessDocument(DOC_ID, USER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s when a live copy of the content already exists', async () => {
      const { service } = buildHarness(
        { documentRows: [docRow({ status: 'failed' })] },
        { uploadDir, uniqueViolation: true },
      );

      await expect(service.reprocessDocument(DOC_ID, USER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('removeDocument', () => {
    it('deletes the row, bumps the KB version, removes the file and audits it', async () => {
      const stored = 'stored.txt';
      await writeFile(path.join(uploadDir, stored), 'content');
      const { service, deleted, cacheIncr, recordAuditLog } = buildHarness(
        { documentRows: [docRow({ kbId: KB_ID, storagePath: stored })] },
        { uploadDir },
      );

      await service.removeDocument(DOC_ID, USER_ID);

      expect(deleted).toEqual([{ table: documents }]);
      expect(cacheIncr).toHaveBeenCalledWith(kbVersionKey(KB_ID));
      await expect(access(path.join(uploadDir, stored))).rejects.toThrow();
      expect(recordAuditLog).toHaveBeenCalledWith({
        userId: USER_ID,
        action: 'document.delete',
        entity: 'document',
        entityId: DOC_ID,
        data: { kbId: KB_ID, filename: 'faq.pdf' },
      });
    });

    it('survives a manually tampered storage path outside UPLOAD_DIR', async () => {
      const outside = path.join(uploadDir, '..', `escape-${path.basename(uploadDir)}.txt`);
      await writeFile(outside, 'keep me');
      const { service, logger } = buildHarness(
        { documentRows: [docRow({ storagePath: `../${path.basename(outside)}` })] },
        { uploadDir },
      );

      await expect(service.removeDocument(DOC_ID, USER_ID)).resolves.toBeUndefined();

      await expect(access(outside)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('escapes UPLOAD_DIR'),
        'KnowledgeBaseService',
      );
      await rm(outside, { force: true });
    });
  });

  describe('ingestion hand-off', () => {
    it('returns the projection the pipeline needs', async () => {
      const { service } = buildHarness({ documentRows: [docRow()] }, { uploadDir });

      const document = await service.getIngestionDocument(DOC_ID);

      expect(document).toMatchObject({
        id: DOC_ID,
        kbId: KB_ID,
        mimeType: 'application/pdf',
        storagePath: null,
        status: 'ready',
        chunkCount: 3,
        contentHash: 'a'.repeat(64),
      });
    });

    it('returns null when the row is gone', async () => {
      const { service } = buildHarness({}, { uploadDir });

      await expect(service.getIngestionDocument(DOC_ID)).resolves.toBeNull();
    });

    it('marks documents ready with the chunk count', async () => {
      const { service, updated } = buildHarness({}, { uploadDir });

      await service.markDocumentReady(DOC_ID, 5);

      expect(updated).toContainEqual({
        table: documents,
        values: { status: 'ready', error: null, chunkCount: 5 },
      });
    });

    it('marks documents failed with a readable error', async () => {
      const { service, updated } = buildHarness({}, { uploadDir });

      await service.markDocumentFailed(DOC_ID, 'parse blew up');

      expect(updated).toContainEqual({
        table: documents,
        values: { status: 'failed', error: 'parse blew up' },
      });
    });
  });
});
