import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UnansweredQuestion } from '@support-agent/shared';

import type { AppLogger } from '../../common/logger/app-logger.service';
import type { AnalyticsService } from './analytics.service';
import { DIGEST_WINDOW_DAYS, DigestService, formatDigest } from './digest';

const WINDOW = { from: '2026-10-11T09:00:00.000Z', to: '2026-10-18T09:00:00.000Z' };

function question(overrides: Partial<UnansweredQuestion> = {}): UnansweredQuestion {
  return {
    query: 'How do I reset my password?',
    count: 4,
    lastSeen: '2026-10-16T12:00:00.000Z',
    sampleConversationId: 'c1',
    ...overrides,
  };
}

interface HarnessOptions {
  items?: UnansweredQuestion[];
  webhookUrl?: string;
  unansweredError?: Error;
}

function buildHarness(options: HarnessOptions = {}) {
  const unanswered = vi.fn(async (_query: unknown) => {
    if (options.unansweredError) {
      throw options.unansweredError;
    }
    return options.items ?? [];
  });
  const config = {
    get: vi.fn((key: string) => (key === 'DIGEST_WEBHOOK_URL' ? options.webhookUrl : undefined)),
  };
  const warn = vi.fn();
  const logger = { log: vi.fn(), warn, error: vi.fn() } as unknown as AppLogger;

  return {
    service: new DigestService(
      { unanswered } as unknown as AnalyticsService,
      config as never,
      logger,
    ),
    unanswered,
    logger,
    warn,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatDigest', () => {
  it('renders an all-clear message for an empty week', () => {
    expect(formatDigest([], WINDOW)).toBe(
      'Weekly top unanswered (2026-10-11 → 2026-10-18)\n\nAll clear — no unanswered questions this week.',
    );
  });

  it('numbers items with counts and last-seen dates', () => {
    const text = formatDigest(
      [
        question(),
        question({ query: 'Where is my invoice?', count: 2, lastSeen: '2026-10-15T08:00:00.000Z' }),
      ],
      WINDOW,
    );

    expect(text.split('\n')).toEqual([
      'Weekly top unanswered (2026-10-11 → 2026-10-18)',
      '',
      '1. "How do I reset my password?" — 4× (last 2026-10-16)',
      '2. "Where is my invoice?" — 2× (last 2026-10-15)',
    ]);
  });

  it('truncates very long queries to keep the message readable', () => {
    const text = formatDigest([question({ query: 'x'.repeat(300) })], WINDOW);
    const line = text.split('\n')[2] ?? '';

    expect(line).toContain(`"${'x'.repeat(117)}..."`);
  });
});

describe('DigestService.run', () => {
  it('clusters the trailing week and logs (not posts) without a webhook', async () => {
    const harness = buildHarness({ items: [question()] });

    const result = await harness.service.run(new Date('2026-10-18T09:00:00Z'));

    expect(result).toEqual({ itemCount: 1, posted: false });
    expect(harness.unanswered).toHaveBeenCalledWith({
      from: '2026-10-11T09:00:00.000Z',
      to: '2026-10-18T09:00:00.000Z',
      limit: 10,
    });
    expect(DIGEST_WINDOW_DAYS).toBe(7);
    const [message] = harness.warn.mock.calls[0] ?? [];
    expect(String(message)).toContain('DIGEST_WEBHOOK_URL is not set');
    expect(String(message)).toContain('1. "How do I reset my password?" — 4×');
  });

  it('posts a Slack-compatible payload when the webhook is configured', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init: unknown) => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const harness = buildHarness({
      items: [question()],
      webhookUrl: 'https://hooks.example.com/support',
    });

    const result = await harness.service.run(new Date('2026-10-18T09:00:00Z'));

    expect(result).toEqual({ itemCount: 1, posted: true });
    expect(fetchMock).toHaveBeenCalledWith('https://hooks.example.com/support', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: formatDigest([question()], WINDOW) }),
    });
    expect(harness.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('digest posted'),
      'DigestService',
    );
  });

  it('throws on a non-2xx webhook response so BullMQ retries the job', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    const harness = buildHarness({ webhookUrl: 'https://hooks.example.com/support' });

    await expect(harness.service.run()).rejects.toThrow('digest webhook responded 500');
  });

  it('propagates analytics failures (no partial digest)', async () => {
    const harness = buildHarness({ unansweredError: new Error('db down') });

    await expect(harness.service.run()).rejects.toThrow('db down');
  });
});
