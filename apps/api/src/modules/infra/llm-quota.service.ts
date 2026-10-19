import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CacheService } from './cache.service';

/** Interactive paid endpoints (playground ask, KB search) per user, per minute. */
export const LLM_USER_REQUESTS_PER_MINUTE = 30;
export const LLM_RATE_LIMITED_MESSAGE = 'Too many AI requests — slow down and try again shortly.';
export const LLM_DAILY_LIMIT_MESSAGE =
  'The daily AI request budget is exhausted. Try again after midnight UTC.';

/**
 * Guards the paid dashboard endpoints against loops (backend audit HIGH): any
 * signed-in role could otherwise hammer embedding/generation calls. One
 * per-user counter per minute, plus an optional global daily budget
 * (`LLM_DAILY_REQUEST_LIMIT`, 0 disables). Cache-backed and fail-open, like
 * every throttle — a Redis outage never blocks an operator.
 */
@Injectable()
export class LlmQuotaService {
  constructor(
    private readonly cache: CacheService,
    private readonly config: ConfigService,
  ) {}

  async enforce(userId: string): Promise<void> {
    const perUser = await this.cache.incrWithTtl(`quota:llm:user:${userId}`, 60);
    if (perUser !== null && perUser > LLM_USER_REQUESTS_PER_MINUTE) {
      throw new HttpException(LLM_RATE_LIMITED_MESSAGE, 429);
    }

    const dailyLimit = this.config.get<number>('LLM_DAILY_REQUEST_LIMIT') ?? 0;
    if (dailyLimit <= 0) {
      return;
    }

    const now = new Date();
    const endOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    const ttlSeconds = Math.ceil((endOfDayUtc - now.getTime()) / 1000) + 3600;
    const day = now.toISOString().slice(0, 10);
    const daily = await this.cache.incrWithTtl(`quota:llm:daily:${day}`, ttlSeconds);
    if (daily !== null && daily > dailyLimit) {
      throw new HttpException(LLM_DAILY_LIMIT_MESSAGE, 429);
    }
  }
}
