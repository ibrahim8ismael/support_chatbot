import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { csrfOriginMiddleware } from './csrf-origin';

const APP_URL = 'https://support.example.com';

function run(method: string, headers: Record<string, string> = {}) {
  const middleware = csrfOriginMiddleware(APP_URL);
  const request = { method, headers } as unknown as Request;
  const response = {
    status: vi.fn(() => response),
    json: vi.fn(() => response),
  } as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  const next = vi.fn();
  middleware(request, response, next as unknown as NextFunction);
  return { response, next };
}

describe('csrfOriginMiddleware', () => {
  it('lets safe methods through', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { next } = run(method, { origin: 'https://evil.example.com' });
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it('lets requests without browser evidence through (CLI, webhooks, tests)', () => {
    const { next } = run('POST');
    expect(next).toHaveBeenCalledOnce();
  });

  it('lets same-origin writes through', () => {
    const { next } = run('POST', {
      origin: APP_URL,
      'sec-fetch-site': 'same-origin',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('blocks a mismatched Origin', () => {
    const { response, next } = run('POST', { origin: 'https://evil.example.com' });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('blocks a cross-site Sec-Fetch-Site before checking Origin', () => {
    const { response, next } = run('POST', {
      origin: APP_URL,
      'sec-fetch-site': 'cross-site',
    });
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });

  it('allows an exact Origin even when Sec-Fetch-Site is same-site', () => {
    const { next } = run('POST', {
      origin: APP_URL,
      'sec-fetch-site': 'same-site',
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
