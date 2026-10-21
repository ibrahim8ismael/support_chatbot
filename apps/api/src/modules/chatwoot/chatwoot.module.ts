import { Module } from '@nestjs/common';

import { MetricsModule } from '../../common/metrics/metrics.module';
import { InfraModule } from '../infra/infra.module';
import { ChatwootWebhookController } from './chatwoot.controller';
import { ChatwootService } from './chatwoot.service';

/**
 * Chatwoot — webhook verification/parsing and outbound API calls.
 * Exposes the shared Chatwoot transport, signature/path verification, inbox
 * discovery, message posting, and label management to other modules.
 */
@Module({
  imports: [MetricsModule, InfraModule],
  controllers: [ChatwootWebhookController],
  providers: [ChatwootService],
  exports: [ChatwootService],
})
export class ChatwootModule {}
