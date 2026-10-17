import { Module } from '@nestjs/common';

import { ChatwootWebhookController } from './chatwoot.controller';
import { ChatwootService } from './chatwoot.service';

/**
 * Chatwoot — webhook verification/parsing and outbound API calls.
 * Exposes to other modules: verifyWebhook(), sendMessage(), addPrivateNote(),
 * addLabel() (repo-structure.md).
 */
@Module({
  controllers: [ChatwootWebhookController],
  providers: [ChatwootService],
  exports: [ChatwootService],
})
export class ChatwootModule {}
