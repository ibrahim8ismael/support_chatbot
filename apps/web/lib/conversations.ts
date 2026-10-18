import {
  conversationListQuerySchema,
  type AnswerOutcome,
  type BotState,
  type MessageSenderType,
} from '@support-agent/shared';

/**
 * Conversations-explorer helpers: query building against the shared schema
 * and display labels (docs/api/rest-api.md § Conversations).
 */

export const BOT_STATE_LABELS: Record<BotState, string> = {
  active: 'Active',
  paused: 'Paused',
  handed_off: 'Handed off',
};

export const SENDER_TYPE_LABELS: Record<MessageSenderType, string> = {
  contact: 'Contact',
  bot: 'Bot',
  human_agent: 'Agent',
  system: 'System',
};

export const OUTCOME_LABELS: Record<AnswerOutcome, string> = {
  answered: 'Answered',
  escalated_low_score: 'Escalated · low score',
  escalated_guard: 'Escalated · guard',
  escalated_request: 'Escalated · requested',
  escalated_classifier: 'Escalated · classifier',
  escalated_repeat: 'Escalated · repeat',
  error: 'Error',
};

export interface ConversationListQueryInput {
  inboxId?: number;
  botState?: BotState;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/**
 * Validate + serialize query params with the same shared schema the API
 * parses (defaults included), so the screen and the API can't drift.
 */
export function buildConversationListQuery(
  input: ConversationListQueryInput,
): { ok: true; query: string } | { ok: false; error: string } {
  const parsed = conversationListQuerySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid filters' };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return { ok: true, query: params.toString() };
}

/** `0.812` → `"0.81"`; `—` when the attempt recorded no score. */
export function formatScore(score: number | null): string {
  return score == null ? '—' : score.toFixed(2);
}

/** Escalation outcomes get the warning colour in the UI; `error` stays neutral. */
export function isEscalationOutcome(outcome: AnswerOutcome): boolean {
  return outcome.startsWith('escalated_');
}

/** Paging label for the list footer: `51–100 of 240` (or `0 of 0`). */
export function pageRangeLabel(offset: number, shown: number, total: number): string {
  return shown === 0 ? `0 of ${total}` : `${offset + 1}–${offset + shown} of ${total}`;
}
