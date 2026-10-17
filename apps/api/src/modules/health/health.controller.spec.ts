import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import type { HealthResponse } from '@support-agent/shared';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

const healthy: HealthResponse = {
  status: 'ok',
  db: 'ok',
  redis: 'ok',
  queue: 'ok',
  version: 'test',
};

describe('HealthController', () => {
  async function buildController(check: () => Promise<HealthResponse>): Promise<HealthController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: { check } }],
    }).compile();

    return moduleRef.get(HealthController);
  }

  it('returns the health payload when every component is up', async () => {
    const controller = await buildController(async () => healthy);

    await expect(controller.get()).resolves.toEqual(healthy);
  });

  it('answers 503 when a component is down', async () => {
    const controller = await buildController(async () => ({
      ...healthy,
      status: 'degraded',
      redis: 'error',
    }));

    await expect(controller.get()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
