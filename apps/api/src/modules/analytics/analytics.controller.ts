import { Controller, Get, Query } from '@nestjs/common';

import {
  USER_ROLES,
  analyticsQuerySchema,
  analyticsTimeseriesQuerySchema,
  analyticsUnansweredQuerySchema,
  type AnalyticsOverview,
  type AnalyticsQuery,
  type AnalyticsTimeseries,
  type AnalyticsTimeseriesQuery,
  type AnalyticsUnansweredQuery,
  type UnansweredQuestion,
} from '@support-agent/shared';

import { ZodQueryPipe } from '../../common/pipes/zod-query.pipe';
import { Roles } from '../auth/auth.decorators';
import { AnalyticsService } from './analytics.service';

/**
 * /api/analytics — dashboard aggregates (docs/api/rest-api.md § Analytics).
 * Metric definitions are a contract; the SQL lives in `AnalyticsService`.
 *
 * `unanswered` returns customer question text from `answer_events`, which
 * security.md § 4 limits to admins — the aggregate endpoints follow the
 * security matrix (all signed-in roles).
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Roles(...USER_ROLES)
  @Get('overview')
  overview(
    @Query(new ZodQueryPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<AnalyticsOverview> {
    return this.analytics.overview(query);
  }

  @Roles(...USER_ROLES)
  @Get('timeseries')
  timeseries(
    @Query(new ZodQueryPipe(analyticsTimeseriesQuerySchema)) query: AnalyticsTimeseriesQuery,
  ): Promise<AnalyticsTimeseries> {
    return this.analytics.timeseries(query);
  }

  @Roles('admin')
  @Get('unanswered')
  unanswered(
    @Query(new ZodQueryPipe(analyticsUnansweredQuerySchema)) query: AnalyticsUnansweredQuery,
  ): Promise<UnansweredQuestion[]> {
    return this.analytics.unanswered(query);
  }
}
