import { Injectable } from '@nestjs/common';

/**
 * Ingestion — writes `chunks`; parse → chunk → embed pipeline.
 * Exposes to other modules: enqueueIngestion(documentId); job handlers.
 * Does NOT do: retrieval.
 *
 * TODO(ingestion): worker consuming `ingest-document` jobs, document parsers
 * (pdfjs/mammoth/text), chunking with metadata, embeddings via `llm`.
 */
@Injectable()
export class IngestionService {}
