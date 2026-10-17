/**
 * Shared types, zod schemas, and constants for `api` and `web`.
 * Keep this package dependency-light — no Node- or browser-only APIs.
 */
export * from './constants';
export * from './schemas/auth.schema';
export * from './schemas/bindings.schema';
export * from './schemas/health.schema';
export * from './schemas/settings.schema';
export * from './types/domain';
