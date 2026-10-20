import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';

import { RuntimeMetricsService } from '../../common/metrics/runtime-metrics.service';
import { Public } from '../auth/auth.decorators';
import { ChatwootService } from './chatwoot.service';

/**
 * POST /api/webhooks/chatwoot/:secret — public endpoint (no session).
 *
 * **Stub status:** the reply pipeline (zod parse → dedupe → queue → reply) is
 * T-201+ and not implemented yet. Until then the handler verifies the path
 * secret and declines with 501, so a wired-up Chatwoot shows failed deliveries
 * instead of silently dropping customer messages
 * (docs/integrations/chatwoot.md § Current status). Wrong secret → 404, never
 * 401 (never confirm the endpoint exists). Unexpected (non-HttpException)
 * failures feed the T-404 webhook 5xx alert.
 */
@Public()
@Controller('webhooks/chatwoot')
export class ChatwootWebhookController {
  constructor(
    private readonly chatwoot: ChatwootService,
    private readonly metrics: RuntimeMetricsService,
  ) {}

  @Post(':secret')
  @HttpCode(501)
  receive(@Param('secret') secret: string, @Body() body: unknown): { status: string } {
    try {
      if (!this.chatwoot.verifyWebhookSecret(secret)) {
        throw new NotFoundException();
      }

      // TODO(T-201): zod-parse the payload (captured fixtures), dedupe on
      // chatwoot_message_id, then hand off to agent.handleIncomingMessage via
      // the reply-job queue with jobId `reply-<conversation_id>` — ADR-0006 —
      // then return 200 and flip this handler back to @HttpCode(200).
      void body;
      return { status: 'not_implemented' };
    } catch (error) {
      // 401/404 are expected client errors; 5xx means we failed to ack Chatwoot.
      if (!(error instanceof HttpException)) {
        this.metrics.recordWebhook5xx();
      }
      throw error;
    }
  }
}
