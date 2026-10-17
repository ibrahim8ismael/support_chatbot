import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Body validation at the edge: parse with a zod schema from
 * `@support-agent/shared` (parse, don't trust — repo-structure.md).
 * Invalid bodies → 400 with per-field details (rest-api.md error shape).
 */
export class ZodBodyPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data as z.infer<TSchema>;
  }
}
