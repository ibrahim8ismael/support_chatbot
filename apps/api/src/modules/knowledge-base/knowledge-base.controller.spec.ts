import { describe, expect, it, vi } from 'vitest';

import type { KnowledgeBaseSummary, KnowledgeDocument, SessionUser } from '@support-agent/shared';

import type { KnowledgeBaseService, UploadedDocumentFile } from './knowledge-base.service';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { DocumentsController } from './documents.controller';

const USER: SessionUser = {
  id: '33333333-3333-4333-8333-333333333333',
  email: 'editor@example.com',
  name: 'Editor',
  role: 'editor',
};

const SUMMARY: KnowledgeBaseSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Support FAQ',
  description: null,
  status: 'active',
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
  documentCount: 0,
  statusCounts: { processing: 0, ready: 0, failed: 0 },
};

const DOCUMENT: KnowledgeDocument = {
  id: '22222222-2222-4222-8222-222222222222',
  kbId: SUMMARY.id,
  sourceType: 'upload',
  filename: 'faq.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 14,
  status: 'ready',
  error: null,
  chunkCount: 3,
  createdAt: '2026-10-18T10:01:00.000Z',
  updatedAt: '2026-10-18T10:01:00.000Z',
};

function buildHarness() {
  const service = {
    list: vi.fn(async () => [SUMMARY]),
    getSummary: vi.fn(async () => SUMMARY),
    create: vi.fn(async () => SUMMARY),
    update: vi.fn(async () => SUMMARY),
    remove: vi.fn(async () => undefined),
    listDocuments: vi.fn(async () => [DOCUMENT]),
    uploadDocument: vi.fn(async () => ({ documentId: DOCUMENT.id, status: 'processing' as const })),
    reprocessDocument: vi.fn(async () => DOCUMENT),
    removeDocument: vi.fn(async () => undefined),
  } as unknown as KnowledgeBaseService;

  return {
    kb: new KnowledgeBaseController(service),
    documents: new DocumentsController(service),
    service,
  };
}

describe('KnowledgeBaseController', () => {
  it('delegates reads to the service', async () => {
    const { kb } = buildHarness();

    await expect(kb.list()).resolves.toEqual([SUMMARY]);
    await expect(kb.get(SUMMARY.id)).resolves.toEqual(SUMMARY);
    await expect(kb.listDocuments(SUMMARY.id)).resolves.toEqual([DOCUMENT]);
  });

  it('creates with the authenticated user and patches with the provided fields', async () => {
    const { kb, service } = buildHarness();

    await kb.create({ name: 'Docs' }, USER);
    expect(service.create).toHaveBeenCalledWith({ name: 'Docs' }, USER.id);

    await kb.update(SUMMARY.id, { status: 'archived' });
    expect(service.update).toHaveBeenCalledWith(SUMMARY.id, { status: 'archived' });
  });

  it('maps delete to a status ack', async () => {
    const { kb, documents, service } = buildHarness();

    await expect(kb.remove(SUMMARY.id)).resolves.toEqual({ status: 'ok' });
    await expect(documents.remove(DOCUMENT.id)).resolves.toEqual({ status: 'ok' });
    await expect(documents.reprocess(DOCUMENT.id)).resolves.toEqual(DOCUMENT);
    expect(service.remove).toHaveBeenCalledWith(SUMMARY.id);
    expect(service.removeDocument).toHaveBeenCalledWith(DOCUMENT.id);
  });

  it('passes the uploaded file through to the service', async () => {
    const { kb, service } = buildHarness();
    const file: UploadedDocumentFile = {
      originalname: 'faq.pdf',
      mimetype: 'application/pdf',
      size: 14,
      buffer: Buffer.from('%PDF-1.7 fixture'),
    };

    await expect(kb.uploadDocument(SUMMARY.id, file, USER)).resolves.toEqual({
      documentId: DOCUMENT.id,
      status: 'processing',
    });
    expect(service.uploadDocument).toHaveBeenCalledWith(SUMMARY.id, file, USER.id);

    await kb.uploadDocument(SUMMARY.id, undefined, USER);
    expect(service.uploadDocument).toHaveBeenCalledWith(SUMMARY.id, undefined, USER.id);
  });
});
