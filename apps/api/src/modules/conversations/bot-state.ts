import type { BotState } from '@support-agent/shared';

/** The bot may only reply while the conversation is `active` (message-flow.md). */
export function canBotReply(conversation: { botState: BotState }): boolean {
  return conversation.botState === 'active';
}
