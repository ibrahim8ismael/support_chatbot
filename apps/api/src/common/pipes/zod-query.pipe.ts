import type { z } from 'zod';

import { ZodBodyPipe } from './zod-body.pipe';

/**
 * Query-string validation — same parse/400 shape as the body pipe, named for
 * `@Query()` parameters so controller signatures read clearly.
 */
export class ZodQueryPipe<TSchema extends z.ZodType> extends ZodBodyPipe<TSchema> {}
