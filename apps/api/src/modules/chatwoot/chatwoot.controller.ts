import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';

import { QUEUES, type ChatwootWebhookJob } from '@support-agent/shared';

import { RuntimeMetricsService } from '../../common/metrics/runtime-metrics.service';
import { QueueService } from '../infra/queue.service';
import { Public } from '../auth/auth.decorators';
import { ChatwootService } from './chatwoot.service';
import { parseChatwootWebhook } from './chatwoot-webhook';

/**
 * POST /api/webhooks/chatwoot/:secret — public endpoint (no session).
 *
 * Verifies the app path secret and Chatwoot HMAC when signing is enabled,
 * accepts supported events quickly, and defers all conversation work to BullMQ.
 */
@Public()
@Controller('webhooks/chatwoot')
export class ChatwootWebhookController {
  constructor(
    private readonly chatwoot: ChatwootService,
    private readonly metrics: RuntimeMetricsService,
    private readonly queue: QueueService,
  ) {}

  @Post(':secret')
  @HttpCode(200)
  async receive(
    @Param('secret') secret: string,
    @Body() body: unknown,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ status: 'accepted' | 'ignored' }> {
    if (!this.chatwoot.verifyWebhookSecret(secret)) {
      throw new NotFoundException();
    }

    const signature = request.header('x-chatwoot-signature');
    const timestamp = request.header('x-chatwoot-timestamp');
    if (!this.chatwoot.verifyWebhookSignature(request.rawBody, signature, timestamp)) {
      throw new UnauthorizedException('Invalid Chatwoot webhook signature');
    }

    let event: ChatwootWebhookJob | null;
    try {
      event = parseChatwootWebhook(body, this.chatwoot.configuredAccountId);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid webhook payload',
      );
    }
    if (!event) {
      return { status: 'ignored' };
    }

    const raw = request.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    const delivery = request.header('x-chatwoot-delivery');
    const idempotencyKey =
      event.kind === 'message_created'
        ? `message-${event.accountId}-${event.chatwootMessageId}`
        : createHash('sha256')
            .update(delivery || raw)
            .digest('hex');
    try {
      await this.queue.enqueue<ChatwootWebhookJob>(QUEUES.reply, 'chatwoot-event', event, {
        jobId: `chatwoot-${idempotencyKey}`,
      });
    } catch (error) {
      this.metrics.recordWebhook5xx();
      throw new InternalServerErrorException('Could not queue Chatwoot event', { cause: error });
    }
    return { status: 'accepted' };
  }
}
