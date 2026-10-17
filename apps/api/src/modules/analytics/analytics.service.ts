import { Injectable } from '@nestjs/common';

/**
 * Analytics — owns `answer_events` and `audit_logs`.
 * Exposes to other modules: aggregation queries for the dashboard; other
 * modules write events through its service.
 * Does NOT do: writing events itself on behalf of others (callers use this service).
 *
 * TODO(analytics): recordAnswerEvent()/recordAuditLog() writers + dashboard
 * aggregation endpoints per docs/api/rest-api.md § metric definitions.
 */
@Injectable()
export class AnalyticsService {}
