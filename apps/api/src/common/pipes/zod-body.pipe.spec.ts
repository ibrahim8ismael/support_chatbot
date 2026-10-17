import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { loginInputSchema } from '@support-agent/shared';

import { ZodBodyPipe } from './zod-body.pipe';

interface InvalidBody {
  details: Array<{ path: string; message: string }>;
}

describe('ZodBodyPipe', () => {
  const pipe = new ZodBodyPipe(loginInputSchema);

  it('returns parsed data for valid bodies', () => {
    expect(pipe.transform({ email: 'user@example.com', password: 'secret' })).toEqual({
      email: 'user@example.com',
      password: 'secret',
    });
  });

  it('rejects invalid bodies with per-field details', () => {
    let caught: unknown;
    try {
      pipe.transform({ email: 'not-an-email', password: '' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = (caught as BadRequestException).getResponse() as InvalidBody;
    expect(response.details.length).toBeGreaterThan(0);
    expect(response.details.map((detail) => detail.path)).toContain('email');
  });
});
