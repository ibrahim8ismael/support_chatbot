import { Body, Controller, Get, Put, ServiceUnavailableException } from '@nestjs/common';

import {
  USER_ROLES,
  settingsUpdateSchema,
  type Settings,
  type SettingsPatch,
} from '@support-agent/shared';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { LlmService } from '../llm/llm.service';
import { Roles } from '../auth/auth.decorators';
import { SettingsService } from './settings.service';

export interface LlmHealthCheck {
  status: 'ok';
  embedding: { model: string; dimensions: number; latencyMs: number };
  chat: { model: string; latencyMs: number };
  totalLatencyMs: number;
}

/**
 * /api/settings — runtime knobs (docs/api/rest-api.md). Reads are open to every
 * signed-in role; writes follow the security matrix (editor/admin,
 * docs/operations/security.md § 2). `health-llm` runs a cheap embedding + chat
 * round-trip for the admin screen.
 *
 * TODO(T-301): audit settings changes via the analytics audit writer.
 */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly llm: LlmService,
  ) {}

  @Roles(...USER_ROLES)
  @Get()
  get(): Promise<Settings> {
    return this.settings.get();
  }

  @Roles('editor', 'admin')
  @Put()
  update(@Body(new ZodBodyPipe(settingsUpdateSchema)) body: SettingsPatch): Promise<Settings> {
    return this.settings.update(body);
  }

  @Roles('admin')
  @Get('health-llm')
  async checkLlm(): Promise<LlmHealthCheck> {
    const started = Date.now();

    try {
      const embedding = await this.llm.embed(['settings health check']);
      const chat = await this.llm.generateReply({
        system: 'You are a health check. Reply briefly.',
        messages: [{ role: 'user', content: 'ping' }],
      });

      return {
        status: 'ok',
        embedding: {
          model: embedding.model,
          dimensions: embedding.dimensions,
          latencyMs: embedding.latencyMs,
        },
        chat: { model: chat.model, latencyMs: chat.latencyMs },
        totalLatencyMs: Date.now() - started,
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        message: `LLM health check failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
