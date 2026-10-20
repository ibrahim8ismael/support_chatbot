/** `ingest-document` job payload (ADR-0006; consumed by the ingestion worker). */
export interface IngestDocumentJob {
  documentId: string;
}

/** `sandbox-run` job payload: one job executes every pending case in the run. */
export interface SandboxRunJob {
  runId: string;
}
