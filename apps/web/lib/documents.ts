import type { DocumentStatus } from '@support-agent/shared';

/**
 * Client-side upload pre-checks. The API sniffs content and is the source of
 * truth (400 bad type / 413 too large / 409 duplicate) — this only saves the
 * user a round-trip for obvious mistakes (T-103 contract).
 */

/** Mirror of the API's multer cap (`MAX_DOCUMENT_BYTES`). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;

export const DOCUMENT_ACCEPT = ALLOWED_DOCUMENT_EXTENSIONS.join(',');

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

/** Returns a user-facing problem, or `null` when the file looks uploadable. */
export function validateUpload(file: Pick<File, 'name' | 'size'>): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.name.slice(dot).toLowerCase();

  if (!(ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return `Unsupported file type — upload ${ALLOWED_DOCUMENT_EXTENSIONS.join(', ')}`;
  }
  if (file.size === 0) {
    return 'The file is empty';
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `The file is larger than ${formatBytes(MAX_DOCUMENT_BYTES)}`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Ingestion runs in the background — drives the dashboard's polling. */
export function hasProcessing(documents: ReadonlyArray<{ status: DocumentStatus }>): boolean {
  return documents.some((document) => document.status === 'processing');
}
