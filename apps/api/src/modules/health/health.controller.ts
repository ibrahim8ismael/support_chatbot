import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import type { HealthResponse } from '@support-agent/shared';

import { HealthService } from './health.service';

/**
 * GET /health — public, outside the /api prefix, used by Docker/compose
 * healthchecks and uptime checks (docs/api/rest-api.md).
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
