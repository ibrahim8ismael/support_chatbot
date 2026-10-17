import { Injectable } from '@nestjs/common';

/**
 * Conversations — owns `conversations` and `messages`.
 * Exposes to other modules: conversation/message upsert & lookup;
 * per-conversation lock.
 * Does NOT do: Chatwoot HTTP details (that is `chatwoot`).
 *
 * TODO(conversations): upsert by chatwoot ids (idempotency on
 * chatwoot_message_id), bot_state transitions, Redis lock helpers.
 */
@Injectable()
export class ConversationsService {}
