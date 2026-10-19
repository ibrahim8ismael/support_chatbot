import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { UnansweredQuestion } from '@support-agent/shared';

import { AppLogger } from '../../common/logger/app-logger.service';
import { AnalyticsService } from './analytics.service';

/**
 * Weekly top-unanswered digest (T-305, roadmap Phase 2 runbook crons). The
 * scheduler posts one repeatable job on the `analytics-followup` queue every
 * Monday 09:00 UTC; the handler clusters the week's unanswered questions with
 * the same contract as `GET /analytics/unanswered` and posts them to
 * `DIGEST_WEBHOOK_URL` — a Slack-compatible webhook (`{"text": "..."}`).
 * Without a webhook the digest is logged instead (dev + self-hosted default).
 */
export const DIGEST_JOB_NAME = 'weekly-digest';
/** Job-scheduler id — BullMQ upserts by id, so restarts never duplicate the schedule. */
export const DIGEST_SCHEDULER_ID = 'weekly-digest';
/** Mondays 09:00 UTC — the weekly review cadence from the roadmap. */
export const DIGEST_CRON = '0 9 * * 1';
export const DIGEST_WINDOW_DAYS = 7;
export const DIGEST_MAX_ITEMS = 10;
/** The webhook POST must not hang the analytics-followup worker. */
const DIGEST_TIMEOUT_MS = 10_000;

const QUERY_MAX_CHARS = 120;
const SERVICE_NAME = 'DigestService';

/** Slack-compatible markdown; deterministic so tests and logs can diff it. */
export function formatDigest(
  items: UnansweredQuestion[],
  window: { from: string; to: string },
): string {
  const header = `Weekly top unanswered (${window.from.slice(0, 10)} → ${window.to.slice(0, 10)})`;
  if (items.length === 0) {
    return `${header}\n\nAll clear — no unanswered questions this week.`;
  }

  const lines = items.map((item, index) => {
    const query =
      item.query.length > QUERY_MAX_CHARS
        ? `${item.query.slice(0, QUERY_MAX_CHARS - 3)}...`
        : item.query;
    return `${index + 1}. "${query}" — ${item.count}× (last ${item.lastSeen.slice(0, 10)})`;
  });

  return [header, '', ...lines].join('\n');
}

export interface DigestRunResult {
  itemCount: number;
  posted: boolean;
}

@Injectable()
export class DigestService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Runs the digest for the trailing week. A configured webhook that answers
   * non-2xx throws, so BullMQ retries (3 attempts, exponential backoff) and a
   * permanently failed job stays inspectable.
   */
  async run(now = new Date()): Promise<DigestRunResult> {
    const to = now;
    const from = new Date(to.getTime() - DIGEST_WINDOW_DAYS * 86_400_000);
    const window = { from: from.toISOString(), to: to.toISOString() };

    const items = await this.analytics.unanswered({
      from: window.from,
      to: window.to,
      limit: DIGEST_MAX_ITEMS,
    });
    const text = formatDigest(items, window);

    const webhookUrl = this.config.get<string>('DIGEST_WEBHOOK_URL');
    if (!webhookUrl) {
      // Question text stays out of the log (customer PII, security.md § 4) —
      // counts only; the digest content goes through the webhook or nowhere.
      this.logger.warn(
        `DIGEST_WEBHOOK_URL is not set — digest not posted (${items.length} unanswered question(s) in the window)`,
        SERVICE_NAME,
      );
      return { itemCount: items.length, posted: false };
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(DIGEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`digest webhook responded ${response.status}`);
    }

    this.logger.log(
      `digest posted: ${items.length} unanswered question(s), ${text.length} chars`,
      SERVICE_NAME,
    );
    return { itemCount: items.length, posted: true };
  }
}
