/**
 * Domain enums — must mirror docs/architecture/data-model.md.
 * These are strings in the database; keep the literals in sync with migrations.
 */

export const USER_ROLES = ['admin', 'editor', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const KB_STATUSES = ['active', 'archived'] as const;
export type KbStatus = (typeof KB_STATUSES)[number];

export const DOCUMENT_STATUSES = ['processing', 'ready', 'failed'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_SOURCE_TYPES = ['upload', 'url', 'text'] as const;
export type DocumentSourceType = (typeof DOCUMENT_SOURCE_TYPES)[number];

export const MESSAGE_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_SENDER_TYPES = ['contact', 'bot', 'human_agent', 'system'] as const;
export type MessageSenderType = (typeof MESSAGE_SENDER_TYPES)[number];

/** Our view of "may the bot reply" in a conversation. */
export const BOT_STATES = ['active', 'paused', 'handed_off'] as const;
export type BotState = (typeof BOT_STATES)[number];

/** One per bot answer attempt — the analytics backbone. */
export const ANSWER_OUTCOMES = [
  'answered',
  'escalated_low_score',
  'escalated_guard',
  'escalated_request',
  'escalated_classifier',
  'escalated_repeat',
  'error',
] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];
