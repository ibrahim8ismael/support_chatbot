/** `ingest-document` job payload (ADR-0006; consumed by the ingestion worker). */
export interface IngestDocumentJob {
  documentId: string;
}
