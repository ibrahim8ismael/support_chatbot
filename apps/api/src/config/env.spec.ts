import { describe, expect, it } from 'vitest';

import { validateEnv } from './env';

const SECRET = 'x'.repeat(32);

describe('validateEnv', () => {
  it('applies safe defaults and coerces types', () => {
    const env = validateEnv({ AUTH_SESSION_SECRET: SECRET });

    expect(env.DATABASE_URL).toBe('postgres://sa:sa@localhost:5432/support_agent');
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.PORT).toBe(3001);
    expect(env.WORKER_CONCURRENCY).toBe(4);
  });

  it('treats empty strings as unset for optional variables', () => {
    const env = validateEnv({
      AUTH_SESSION_SECRET: SECRET,
      CHATWOOT_BASE_URL: '',
      CHATWOOT_ACCOUNT_ID: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
    });

    expect(env.CHATWOOT_BASE_URL).toBeUndefined();
    expect(env.CHATWOOT_ACCOUNT_ID).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it('refuses to start with a missing or short session secret', () => {
    expect(() => validateEnv({})).toThrow(/AUTH_SESSION_SECRET/);
    expect(() => validateEnv({ AUTH_SESSION_SECRET: 'too-short' })).toThrow(/AUTH_SESSION_SECRET/);
  });

  it('requires the provider keys when a real provider is selected', () => {
    expect(() => validateEnv({ AUTH_SESSION_SECRET: SECRET, LLM_PROVIDER: 'openai' })).toThrow(
      /OPENAI_API_KEY/,
    );
    expect(() => validateEnv({ AUTH_SESSION_SECRET: SECRET, LLM_PROVIDER: 'openrouter' })).toThrow(
      /OPENROUTER_API_KEY/,
    );
    // Embeddings stay with OpenAI (D3) even when chat goes through OpenRouter.
    expect(() =>
      validateEnv({
        AUTH_SESSION_SECRET: SECRET,
        LLM_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'sk-or-test',
      }),
    ).toThrow(/OPENAI_API_KEY/);
  });

  it('accepts a configured provider', () => {
    const openai = validateEnv({
      AUTH_SESSION_SECRET: SECRET,
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(openai.OPENAI_API_KEY).toBe('sk-test');

    const openrouter = validateEnv({
      AUTH_SESSION_SECRET: SECRET,
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(openrouter.LLM_PROVIDER).toBe('openrouter');
    expect(openrouter.OPENROUTER_API_KEY).toBe('sk-or-test');
  });
});
