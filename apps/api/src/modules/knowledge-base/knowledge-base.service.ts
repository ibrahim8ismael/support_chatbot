import { Injectable } from '@nestjs/common';

/**
 * Knowledge base — owns `knowledge_bases` and `documents`.
 * Exposes to other modules: KB/document CRUD, getBoundKbIdsForInbox().
 * Does NOT do: parsing/chunking/embedding (that is `ingestion`).
 *
 * TODO(knowledge-base): CRUD endpoints + document upload endpoints per
 * docs/api/rest-api.md; uploads land in UPLOAD_DIR (D9).
 */
@Injectable()
export class KnowledgeBaseService {}
