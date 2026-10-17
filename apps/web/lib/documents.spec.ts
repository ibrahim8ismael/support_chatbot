import { describe, expect, it } from 'vitest';

import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  DOCUMENT_ACCEPT,
  MAX_DOCUMENT_BYTES,
  formatBytes,
  hasProcessing,
  validateUpload,
} from './documents';

function file(name: string, size = 1024): { name: string; size: number } {
  return { name, size };
}

describe('validateUpload', () => {
  it('accepts every supported extension', () => {
    expect(validateUpload(file('guide.pdf'))).toBeNull();
    expect(validateUpload(file('guide.docx'))).toBeNull();
    expect(validateUpload(file('notes.txt'))).toBeNull();
    expect(validateUpload(file('readme.md'))).toBeNull();
  });

  it('accepts extensions case-insensitively', () => {
    expect(validateUpload(file('GUIDE.PDF'))).toBeNull();
  });

  it('rejects unsupported extensions and missing extensions', () => {
    expect(validateUpload(file('sheet.xlsx'))).toMatch(/Unsupported/);
    expect(validateUpload(file('no-extension'))).toMatch(/Unsupported/);
  });

  it('rejects empty files', () => {
    expect(validateUpload(file('a.txt', 0))).toMatch(/empty/);
  });

  it('rejects files above the API cap but accepts exactly the cap', () => {
    expect(validateUpload(file('a.txt', MAX_DOCUMENT_BYTES + 1))).toMatch(/20\.0 MB/);
    expect(validateUpload(file('a.txt', MAX_DOCUMENT_BYTES))).toBeNull();
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes, and megabytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(MAX_DOCUMENT_BYTES)).toBe('20.0 MB');
  });
});

describe('hasProcessing', () => {
  it('detects background ingestion', () => {
    expect(hasProcessing([{ status: 'ready' }, { status: 'failed' }])).toBe(false);
    expect(hasProcessing([{ status: 'ready' }, { status: 'processing' }])).toBe(true);
    expect(hasProcessing([])).toBe(false);
  });
});

describe('exported constants', () => {
  it('keeps the accept list in sync with the API contract', () => {
    expect(DOCUMENT_ACCEPT).toBe('.pdf,.docx,.txt,.md');
    expect(ALLOWED_DOCUMENT_EXTENSIONS).toHaveLength(4);
  });
});
