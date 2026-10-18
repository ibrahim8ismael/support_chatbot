import { Controller, Get, Query } from '@nestjs/common';

import { auditLogQuerySchema, type AuditLogList, type AuditLogQuery } from '@support-agent/shared';

import { ZodQueryPipe } from '../../common/pipes/zod-query.pipe';
import { Roles } from '../auth/auth.decorators';
import { AnalyticsService } from './analytics.service';

/**
 * /api/audit-logs — admin-only read of `audit_logs`
 * (docs/api/rest-api.md § Audit log). The audit trail names users and carries
 * operational data, so the security matrix limits it to admins.
 */
@Controller('audit-logs')
@Roles('admin')
export class AuditLogController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  list(@Query(new ZodQueryPipe(auditLogQuerySchema)) query: AuditLogQuery): Promise<AuditLogList> {
    return this.analytics.listAuditLogs(query);
  }
}
