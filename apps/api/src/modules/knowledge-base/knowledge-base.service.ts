import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, ne } from 'drizzle-orm';

import {
  QUEUES,
  kbVersionKey,
  type DocumentStatus,
  type IngestDocumentJob,
  type KnowledgeBaseInput,
  type KnowledgeBaseSummary,
  type KnowledgeBaseUpdate,
  type KnowledgeDocument,
} from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { DatabaseService } from '../../db/database.service';
import { BindingsService } from '../bindings/bindings.service';
import { CacheService } from '../infra/cache.service';
import { QueueService } from '../infra/queue.service';
import {
  contentHash,
  extensionForUpload,
  sanitizeUploadFilename,
  sniffMimeType,
  uploadRejection,
  validateUploadSize,
} from './document-file';
import { documents } from './entities/document.entity';
import { knowledgeBases } from './entities/knowledge-base.entity';

type KbRow = typeof knowledgeBases.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;

interface StatusCounts {
  processing: number;
  ready: number;
  failed: number;
}

/** Multer memory-storage file (subset we rely on). */
export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Knowledge base — owns `knowledge_bases` and `documents`.
 * Exposes to other modules: KB/document CRUD and metadata; ingestion reads the
 * stored file + `content_hash` from `documents`.
 * Does NOT do: parsing/chunking/embedding (that is `ingestion`), or Chatwoot.
 *
 * Uploads land in `UPLOAD_DIR` under a generated name; the user-supplied
 * filename is only kept for display. Deleting a document cascades its chunks
 * (`chunks.document_id ON DELETE CASCADE`) and bumps the KB version counter so
 * retrieval caches miss.
 */
@Injectable()
export class KnowledgeBaseService {
  private readonly uploadDir: string;

  constructor(
    private readonly database: DatabaseService,
    private readonly queue: QueueService,
    private readonly bindings: BindingsService,
    private readonly cache: CacheService,
    private readonly logger: AppLogger,
    config: ConfigService,
  ) {
    this.uploadDir = path.resolve(config.get<string>('UPLOAD_DIR') ?? './data/uploads');
  }

  /** KBs with document counts + status summary (dashboard list). */
  async list(): Promise<KnowledgeBaseSummary[]> {
    const [rows, counts] = await Promise.all([
      this.database.db.select().from(knowledgeBases).orderBy(asc(knowledgeBases.name)),
      this.loadStatusCounts(),
    ]);
    return rows.map((row) => toSummary(row, counts.get(row.id)));
  }

  async getSummary(id: string): Promise<KnowledgeBaseSummary> {
    const row = await this.loadKb(id);
    const counts = await this.loadStatusCounts(id);
    return toSummary(row, counts.get(id));
  }

  async create(input: KnowledgeBaseInput, userId: string): Promise<KnowledgeBaseSummary> {
    const [row] = await this.database.db
      .insert(knowledgeBases)
      .values({
        name: input.name,
        description: input.description ?? null,
        createdBy: userId,
      })
      .returning();

    if (!row) {
      throw new Error('failed to create knowledge base');
    }
    return toSummary(row);
  }

  /** Rename / re-describe / archive (PATCH semantics). */
  async update(id: string, patch: KnowledgeBaseUpdate): Promise<KnowledgeBaseSummary> {
    const values: Partial<typeof knowledgeBases.$inferInsert> = {};
    if (patch.name !== undefined) {
      values.name = patch.name;
    }
    if (patch.description !== undefined) {
      values.description = patch.description;
    }
    if (patch.status !== undefined) {
      values.status = patch.status;
    }

    const [row] = await this.database.db
      .update(knowledgeBases)
      .set(values)
      .where(eq(knowledgeBases.id, id))
      .returning();

    if (!row) {
      throw new NotFoundException(`knowledge base ${id} not found`);
    }

    const counts = await this.loadStatusCounts(id);
    return toSummary(row, counts.get(id));
  }

  /**
   * Hard delete (archive via PATCH instead). Refuses while an inbox is bound so
   * a live bot never loses its KB; documents/chunks cascade, stored files are
   * removed best-effort.
   */
  async remove(id: string): Promise<void> {
    const kb = await this.loadKb(id);
    if (await this.bindings.isKbBound(kb.id)) {
      throw new ConflictException('knowledge base is bound to an inbox — unbind it first');
    }

    const files = await this.database.db
      .select({ storagePath: documents.storagePath })
      .from(documents)
      .where(eq(documents.kbId, id));

    await this.database.db.delete(knowledgeBases).where(eq(knowledgeBases.id, id));
    await this.cache.del(kbVersionKey(id));
    await Promise.all(files.map((file) => this.removeStoredFile(file.storagePath)));
  }

  async listDocuments(kbId: string): Promise<KnowledgeDocument[]> {
    await this.loadKb(kbId);
    const rows = await this.database.db
      .select()
      .from(documents)
      .where(eq(documents.kbId, kbId))
      .orderBy(desc(documents.createdAt));
    return rows.map(toDocument);
  }

  /**
   * Store the original, create a `processing` row, and enqueue ingestion.
   * Content is sniffed (not trusted by extension), hashed, and deduplicated per
   * KB unless the previous copy failed.
   */
  async uploadDocument(
    kbId: string,
    file: UploadedDocumentFile | undefined,
    userId: string,
  ): Promise<{ documentId: string; status: DocumentStatus }> {
    await this.loadKb(kbId);

    if (!file) {
      throw uploadRejection('file is required (multipart field "file")');
    }
    validateUploadSize(file.size);

    const extension = extensionForUpload(file.originalname);
    const mimeType = sniffMimeType(file.buffer, extension);
    const hash = contentHash(file.buffer);

    const [duplicate] = await this.database.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          eq(documents.kbId, kbId),
          eq(documents.contentHash, hash),
          ne(documents.status, 'failed'),
        ),
      )
      .limit(1);

    if (duplicate) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: 'identical document already exists in this knowledge base',
        details: [{ path: 'file', message: `same content as document ${duplicate.id}` }],
      });
    }

    const storageName = `${randomUUID()}${extension}`;
    const absolutePath = this.resolveStoragePath(storageName);
    await mkdir(this.uploadDir, { recursive: true });
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });

    let row: DocumentRow | undefined;
    try {
      [row] = await this.database.db
        .insert(documents)
        .values({
          kbId,
          sourceType: 'upload',
          filename: sanitizeUploadFilename(file.originalname),
          mimeType,
          sizeBytes: file.size,
          storagePath: storageName,
          status: 'processing',
          chunkCount: 0,
          contentHash: hash,
          createdBy: userId,
        })
        .returning();
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }

    if (!row) {
      await unlink(absolutePath).catch(() => undefined);
      throw new Error('failed to create document row');
    }

    try {
      await this.enqueueIngestion(row.id);
    } catch (error) {
      this.logger.error(
        `failed to enqueue ingestion for document ${row.id}: ${String(error)}`,
        KnowledgeBaseService.name,
      );
      await this.database.db
        .update(documents)
        .set({
          status: 'failed',
          error: 'ingestion could not be queued — retry reprocess',
        })
        .where(eq(documents.id, row.id));
      throw new ServiceUnavailableException(
        'ingestion queue unavailable — document was saved, retry via reprocess',
      );
    }

    return { documentId: row.id, status: row.status };
  }

  /** Reset status and re-run the pipeline (same file, idempotent replace). */
  async reprocessDocument(documentId: string): Promise<KnowledgeDocument> {
    await this.loadDocument(documentId);

    const [row] = await this.database.db
      .update(documents)
      .set({ status: 'processing', error: null, chunkCount: 0 })
      .where(eq(documents.id, documentId))
      .returning();

    if (!row) {
      throw new NotFoundException(`document ${documentId} not found`);
    }

    try {
      await this.enqueueIngestion(documentId);
    } catch (error) {
      this.logger.error(
        `failed to enqueue reprocess for document ${documentId}: ${String(error)}`,
        KnowledgeBaseService.name,
      );
      await this.database.db
        .update(documents)
        .set({
          status: 'failed',
          error: 'ingestion could not be queued — retry reprocess',
        })
        .where(eq(documents.id, documentId));
      throw new ServiceUnavailableException('ingestion queue unavailable — retry reprocess');
    }

    return toDocument(row);
  }

  /** Removes the document + chunks (cascade) and bumps the KB version counter. */
  async removeDocument(documentId: string): Promise<void> {
    const document = await this.loadDocument(documentId);
    await this.database.db.delete(documents).where(eq(documents.id, documentId));
    await this.cache.incr(kbVersionKey(document.kbId));
    await this.removeStoredFile(document.storagePath);
  }

  private enqueueIngestion(documentId: string): Promise<string | undefined> {
    return this.queue.enqueue<IngestDocumentJob>(QUEUES.ingestDocument, 'ingest-document', {
      documentId,
    });
  }

  private async loadKb(id: string): Promise<KbRow> {
    const [row] = await this.database.db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`knowledge base ${id} not found`);
    }
    return row;
  }

  private async loadDocument(id: string): Promise<DocumentRow> {
    const [row] = await this.database.db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    if (!row) {
      throw new NotFoundException(`document ${id} not found`);
    }
    return row;
  }

  private async loadStatusCounts(kbId?: string): Promise<Map<string, StatusCounts>> {
    const query = this.database.db
      .select({ kbId: documents.kbId, status: documents.status, total: count() })
      .from(documents);

    const rows = kbId
      ? await query.where(eq(documents.kbId, kbId)).groupBy(documents.kbId, documents.status)
      : await query.groupBy(documents.kbId, documents.status);

    const counts = new Map<string, StatusCounts>();
    for (const row of rows) {
      const current = counts.get(row.kbId) ?? { processing: 0, ready: 0, failed: 0 };
      current[row.status] += row.total;
      counts.set(row.kbId, current);
    }
    return counts;
  }

  /** Storage paths are always under UPLOAD_DIR — reject anything else. */
  private resolveStoragePath(storagePath: string): string {
    const resolved = path.resolve(this.uploadDir, storagePath);
    if (resolved !== this.uploadDir && !resolved.startsWith(`${this.uploadDir}${path.sep}`)) {
      throw new Error(`stored path escapes UPLOAD_DIR: ${storagePath}`);
    }
    return resolved;
  }

  private async removeStoredFile(storagePath: string | null): Promise<void> {
    if (!storagePath) {
      return;
    }
    try {
      await unlink(this.resolveStoragePath(storagePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(
          `failed to remove stored file ${storagePath}: ${String(error)}`,
          KnowledgeBaseService.name,
        );
      }
    }
  }
}

function toSummary(row: KbRow, counts?: StatusCounts): KnowledgeBaseSummary {
  const statusCounts = counts ?? { processing: 0, ready: 0, failed: 0 };
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    documentCount: statusCounts.processing + statusCounts.ready + statusCounts.failed,
    statusCounts,
  };
}

function toDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    kbId: row.kbId,
    sourceType: row.sourceType,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
