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
 * Verifies the path secret; 200 fast; queues work (docs/api/rest-api.md).
 * Unexpected (non-HttpException) failures feed the T-404 webhook 5xx alert.
 */
@Public()
@Controller('webhooks/chatwoot')
export class ChatwootWebhookController {
  constructor(
    private readonly chatwoot: ChatwootService,
    private readonly metrics: RuntimeMetricsService,
  ) {}

  @Post(':secret')
  @HttpCode(200)
  receive(@Param('secret') secret: string, @Body() body: unknown): { status: string } {
    try {
      if (!this.chatwoot.verifyWebhookSecret(secret)) {
        throw new NotFoundException();
      }

      // TODO(agent): parse the payload with a zod schema (fixtures), dedupe on
      // chatwoot_message_id, then hand off to agent.handleIncomingMessage via the
      // reply-job queue with jobId `reply:<conversation_id>` — ADR-0006.
      void body;
      return { status: 'accepted' };
    } catch (error) {
      // 401/404 are expected client errors; 5xx means we failed to ack Chatwoot.
      if (!(error instanceof HttpException)) {
        this.metrics.recordWebhook5xx();
      }
      throw error;
    }
  }
}
