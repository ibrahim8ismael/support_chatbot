import type { ConfigService } from '@nestjs/config';

import type { Settings } from '@support-agent/shared';

import { ANSWER_PROMPT_V2 } from '../agent/prompts/answer.v2';

/**
 * Defaults from docs/architecture/data-model.md § settings. Model ids follow
 * env (D2 closed: `LLM_PROVIDER=mock|openai|openrouter`); the settings keys are
 * the future runtime override, which the mock ignores for now.
 */
export function buildSettingsDefaults(config: ConfigService): Settings {
  return {
    bot_enabled: false,
    system_prompt: ANSWER_PROMPT_V2,
    fallback_message: "I'm not sure about that — let me get a human colleague for you.",
    retrieval_top_k: 10,
    retrieval_score_threshold: 0.35,
    context_chunks: 5,
    max_reply_chars: 800,
    embedding_model: config.get<string>('EMBEDDING_MODEL') ?? 'text-embedding-3-small',
    chat_model: config.get<string>('CHAT_MODEL') ?? 'gpt-4.1-mini',
  };
}
