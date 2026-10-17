import path from 'node:path';

/**
 * Files are addressed by a name relative to `UPLOAD_DIR` (D9). Anything that
 * escapes the volume (hand-edited DB rows, traversal attempts) is rejected
 * before it reaches the filesystem.
 */
export function resolveUploadPath(uploadDir: string, storagePath: string): string {
  const resolved = path.resolve(uploadDir, storagePath);
  if (resolved !== uploadDir && !resolved.startsWith(`${uploadDir}${path.sep}`)) {
    throw new Error(`stored path escapes UPLOAD_DIR: ${storagePath}`);
  }
  return resolved;
}
