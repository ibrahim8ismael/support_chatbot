/**
 * Provider-specific chat defaults. `CHAT_MODEL` is optional so selecting a
 * provider does not silently send that provider a model id from another one.
 * Embeddings are not here: they stay on OpenAI (D3).
 */
export const OPENAI_DEFAULT_CHAT_MODEL = 'gpt-4.1-mini';
export const OPENROUTER_DEFAULT_CHAT_MODEL = 'openai/gpt-4.1-mini';
export const GEMINI_DEFAULT_CHAT_MODEL = 'gemini-3.8-flash';
export const VERTEX_DEFAULT_CHAT_MODEL = 'gemini-3.8-flash';

export function defaultChatModel(provider: string): string {
  switch (provider) {
    case 'openrouter':
      return OPENROUTER_DEFAULT_CHAT_MODEL;
    case 'gemini':
      return GEMINI_DEFAULT_CHAT_MODEL;
    case 'vertex':
      return VERTEX_DEFAULT_CHAT_MODEL;
    default:
      return OPENAI_DEFAULT_CHAT_MODEL;
  }
}

export function resolveChatModel(provider: string, configured?: string): string {
  return configured ?? defaultChatModel(provider);
}
