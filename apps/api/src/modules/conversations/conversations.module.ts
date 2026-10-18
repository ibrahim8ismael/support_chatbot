import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * Conversations — owns `conversations` and `messages`. Chatwoot HTTP details
 * stay in the `chatwoot` module; per-conversation locks live in `infra`.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
