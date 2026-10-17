import { createHash } from 'node:crypto';
import path from 'node:path';

import { BadRequestException } from '@nestjs/common';

import { MAX_DOCUMENT_BYTES } from '@support-agent/shared';

/**
 * Upload validation for FR-2: allowed types, size, and *content sniffing* —
 * extension alone is never trusted (docs/operations/security.md § 6).
 */
export const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;

export type AllowedUploadExtension = (typeof ALLOWED_UPLOAD_EXTENSIONS)[number];

const MIME_BY_EXTENSION: Record<AllowedUploadExtension, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

const PDF_MAGIC = Buffer.from('%PDF-');

export function uploadRejection(message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    details: [{ path: 'file', message }],
  });
}

/** Extension gate; the returned extension decides sniffing + storage name. */
export function extensionForUpload(filename: string): AllowedUploadExtension {
  const extension = path.extname(filename.toLowerCase());
  if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
    throw uploadRejection(
      `unsupported file type "${extension || '(none)'}" — allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}`,
    );
  }
  return extension as AllowedUploadExtension;
}

/** Size gate (multer also enforces this at the edge → 413). */
export function validateUploadSize(size: number): void {
  if (size <= 0) {
    throw uploadRejection('file is empty');
  }
  if (size > MAX_DOCUMENT_BYTES) {
    throw uploadRejection(`file exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB limit`);
  }
}

/**
 * Verify the bytes match the claimed type and return the canonical mime type.
 * PDF → `%PDF-`; DOCX → zip container (`PK`); TXT/MD → valid UTF-8 without NUL.
 */
export function sniffMimeType(buffer: Buffer, extension: AllowedUploadExtension): string {
  if (extension === '.pdf') {
    if (!buffer.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw uploadRejection('file content is not a PDF');
    }
    return MIME_BY_EXTENSION['.pdf'];
  }

  if (extension === '.docx') {
    const isZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
    if (!isZip) {
      throw uploadRejection('file content is not a DOCX (zip) container');
    }
    return MIME_BY_EXTENSION['.docx'];
  }

  if (buffer.includes(0)) {
    throw uploadRejection('text uploads must not contain binary data');
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw uploadRejection('file is not valid UTF-8 text');
  }
  return MIME_BY_EXTENSION[extension];
}

/** sha256 of raw bytes — dedupe + "skip re-embedding if unchanged". */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Display-safe filename: no paths, no control characters, bounded length. */
export function sanitizeUploadFilename(original: string): string {
  const base = Array.from(path.basename(original.replace(/\\/g, '/')))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim();
  if (base.length === 0 || /^\.+$/.test(base)) {
    return 'upload';
  }
  return base.slice(0, 255);
}
