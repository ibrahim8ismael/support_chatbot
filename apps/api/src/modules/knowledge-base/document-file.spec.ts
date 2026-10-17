import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { MAX_DOCUMENT_BYTES } from '@support-agent/shared';

import {
  contentHash,
  extensionForUpload,
  sanitizeUploadFilename,
  sniffMimeType,
  validateUploadSize,
} from './document-file';

const PDF_BYTES = Buffer.from('%PDF-1.7\nfixture');
const DOCX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);

/** The 400 body keeps `message: 'Validation failed'`; reasons live in `details`. */
async function rejectionMessage(run: () => unknown): Promise<string> {
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

describe('extensionForUpload', () => {
  it('accepts the four documented types, case-insensitively', () => {
    expect(extensionForUpload('manual.pdf')).toBe('.pdf');
    expect(extensionForUpload('Manual.PDF')).toBe('.pdf');
    expect(extensionForUpload('spec.docx')).toBe('.docx');
    expect(extensionForUpload('notes.txt')).toBe('.txt');
    expect(extensionForUpload('guide.md')).toBe('.md');
  });

  it('rejects everything else with the allowed list', async () => {
    await expect(rejectionMessage(() => extensionForUpload('noextension'))).resolves.toMatch(
      /unsupported file type/,
    );
  });
});

describe('validateUploadSize', () => {
  it('rejects empty files', async () => {
    await expect(rejectionMessage(() => validateUploadSize(0))).resolves.toMatch(/empty/);
  });

  it('rejects files over the FR-2 limit', async () => {
    await expect(
      rejectionMessage(() => validateUploadSize(MAX_DOCUMENT_BYTES + 1)),
    ).resolves.toMatch(/20 MB/);
    expect(() => validateUploadSize(MAX_DOCUMENT_BYTES)).not.toThrow();
  });
});

describe('sniffMimeType', () => {
  it('accepts a real PDF by magic bytes', () => {
    expect(sniffMimeType(PDF_BYTES, '.pdf')).toBe('application/pdf');
  });

  it('rejects a PDF extension without PDF bytes', async () => {
    await expect(
      rejectionMessage(() => sniffMimeType(Buffer.from('hello'), '.pdf')),
    ).resolves.toMatch(/not a PDF/);
  });

  it('accepts DOCX as a zip container', () => {
    expect(sniffMimeType(DOCX_BYTES, '.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('rejects DOCX without zip bytes', async () => {
    await expect(rejectionMessage(() => sniffMimeType(PDF_BYTES, '.docx'))).resolves.toMatch(
      /not a DOCX/,
    );
  });

  it('accepts UTF-8 text and markdown', () => {
    expect(sniffMimeType(Buffer.from('reset your password here\n'), '.txt')).toBe('text/plain');
    expect(sniffMimeType(Buffer.from('# Title\n'), '.md')).toBe('text/markdown');
  });

  it('rejects text with NUL bytes and invalid UTF-8', async () => {
    await expect(
      rejectionMessage(() => sniffMimeType(Buffer.from([0x68, 0x00, 0x69]), '.txt')),
    ).resolves.toMatch(/binary/);
    await expect(
      rejectionMessage(() => sniffMimeType(Buffer.from([0xff, 0xfe, 0x68]), '.txt')),
    ).resolves.toMatch(/UTF-8/);
  });
});

describe('contentHash', () => {
  it('is the sha256 hex of the raw bytes', () => {
    expect(contentHash(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('sanitizeUploadFilename', () => {
  it('strips paths, control characters, and bounds the length', () => {
    expect(sanitizeUploadFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeUploadFilename('C:\\Users\\ceo\\faq.pdf')).toBe('faq.pdf');
    expect(sanitizeUploadFilename('a\u0000b\u001fc.txt')).toBe('abc.txt');
    expect(sanitizeUploadFilename('x'.repeat(300)).length).toBe(255);
  });

  it('falls back to "upload" when nothing usable is left', () => {
    expect(sanitizeUploadFilename('..')).toBe('upload');
  });
});
