import type { ConfigService } from '@nestjs/config';

import type { Settings } from '@support-agent/shared';

import { ANSWER_PROMPT_V1 } from '../agent/prompts/answer.v1';

/**
 * Defaults from docs/architecture/data-model.md § settings. Model ids follow
 * env until D2 wires real providers (the settings keys are the future runtime
 * override; the mock ignores them).
 */
export function buildSettingsDefaults(config: ConfigService): Settings {
  return {
    bot_enabled: false,
    system_prompt: ANSWER_PROMPT_V1,
    fallback_message: "I'm not sure about that — let me get a human colleague for you.",
    retrieval_top_k: 10,
    retrieval_score_threshold: 0.35,
    context_chunks: 5,
    max_reply_chars: 800,
    embedding_model: config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small',
    chat_model: config.get<string>('CHAT_MODEL') ?? 'gpt-4.1-mini',
  };
}
