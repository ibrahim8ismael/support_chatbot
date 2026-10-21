import { describe, expect, it } from 'vitest';

import { validateEnv } from './env';

describe('validateEnv', () => {
  it('applies safe defaults and coerces types', () => {
    const env = validateEnv({});

    expect(env.APP_URL).toBe('http://localhost:3000');
    expect(env.DATABASE_URL).toBe('postgres://sa:sa@localhost:5432/support_agent');
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.PORT).toBe(3001);
    expect(env.WORKER_CONCURRENCY).toBe(2);
  });

  it('treats empty strings as unset for optional variables', () => {
    const env = validateEnv({
      CHATWOOT_BASE_URL: '',
      CHATWOOT_ACCOUNT_ID: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      GEMINI_API_KEY: '',
      GOOGLE_GENERATIVE_AI_API_KEY: '',
      GOOGLE_VERTEX_API_KEY: '',
      GOOGLE_VERTEX_PROJECT: '',
      GOOGLE_VERTEX_LOCATION: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      DIGEST_WEBHOOK_URL: '',
    });

    expect(env.CHATWOOT_BASE_URL).toBeUndefined();
    expect(env.CHATWOOT_ACCOUNT_ID).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_GENERATIVE_AI_API_KEY).toBeUndefined();
    expect(env.GOOGLE_VERTEX_API_KEY).toBeUndefined();
    expect(env.GOOGLE_VERTEX_PROJECT).toBeUndefined();
    expect(env.GOOGLE_VERTEX_LOCATION).toBeUndefined();
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(env.DIGEST_WEBHOOK_URL).toBeUndefined();
  });

  it('ignores the removed AUTH_SESSION_SECRET (sessions are server-side rows)', () => {
    const env = validateEnv({
      AUTH_SESSION_SECRET: 'dev-only-change-me-0123456789abcdef0123456789abcdef',
    });

    expect('AUTH_SESSION_SECRET' in env).toBe(false);
  });

  it('requires the provider keys when a real provider is selected', () => {
    expect(() => validateEnv({ LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ LLM_PROVIDER: 'openrouter' })).toThrow(/OPENROUTER_API_KEY/);
    // Embeddings stay with OpenAI (D3) even when chat goes through OpenRouter.
    expect(() =>
      validateEnv({
        LLM_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'sk-or-test',
      }),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ LLM_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    // Embeddings stay with OpenAI (D3) even when chat goes through Gemini.
    expect(() =>
      validateEnv({
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gemini-test',
      }),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() => validateEnv({ LLM_PROVIDER: 'vertex' })).toThrow(/GOOGLE_VERTEX_API_KEY/);
    // Embeddings stay with OpenAI (D3) even when chat goes through Vertex.
    expect(() =>
      validateEnv({
        LLM_PROVIDER: 'vertex',
        GOOGLE_VERTEX_API_KEY: 'vertex-test',
      }),
    ).toThrow(/OPENAI_API_KEY/);
    // ADC mode needs an explicit project and location (the SDK has no defaults).
    expect(() =>
      validateEnv({
        LLM_PROVIDER: 'vertex',
        OPENAI_API_KEY: 'sk-test',
      }),
    ).toThrow(/GOOGLE_VERTEX_PROJECT/);
    expect(() =>
      validateEnv({
        LLM_PROVIDER: 'vertex',
        GOOGLE_VERTEX_PROJECT: 'my-project',
        OPENAI_API_KEY: 'sk-test',
      }),
    ).toThrow(/GOOGLE_VERTEX_LOCATION/);
  });

  it('accepts a configured provider', () => {
    const openai = validateEnv({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(openai.OPENAI_API_KEY).toBe('sk-test');

    const openrouter = validateEnv({
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(openrouter.LLM_PROVIDER).toBe('openrouter');
    expect(openrouter.OPENROUTER_API_KEY).toBe('sk-or-test');

    const gemini = validateEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(gemini.LLM_PROVIDER).toBe('gemini');
    expect(gemini.GEMINI_API_KEY).toBe('gemini-test');

    const geminiAlias = validateEnv({
      LLM_PROVIDER: 'gemini',
      GOOGLE_GENERATIVE_AI_API_KEY: 'google-test',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(geminiAlias.GOOGLE_GENERATIVE_AI_API_KEY).toBe('google-test');

    const vertexExpress = validateEnv({
      LLM_PROVIDER: 'vertex',
      GOOGLE_VERTEX_API_KEY: 'vertex-test',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(vertexExpress.LLM_PROVIDER).toBe('vertex');
    expect(vertexExpress.GOOGLE_VERTEX_API_KEY).toBe('vertex-test');

    const vertexAdc = validateEnv({
      LLM_PROVIDER: 'vertex',
      GOOGLE_VERTEX_PROJECT: 'my-project',
      GOOGLE_VERTEX_LOCATION: 'us-central1',
      GOOGLE_APPLICATION_CREDENTIALS: '/run/secrets/vertex.json',
      OPENAI_API_KEY: 'sk-test',
    });
    expect(vertexAdc.GOOGLE_VERTEX_PROJECT).toBe('my-project');
    expect(vertexAdc.GOOGLE_VERTEX_LOCATION).toBe('us-central1');
    expect(vertexAdc.GOOGLE_APPLICATION_CREDENTIALS).toBe('/run/secrets/vertex.json');
  });

  it('requires explicit APP_URL and REDIS_URL in production', () => {
    const base = {
      NODE_ENV: 'production',
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      DATABASE_URL: 'postgres://user:secret@db:5432/support_agent',
      COMPANY_NAME: 'Support Agent',
    };

    expect(() => validateEnv(base)).toThrow(/APP_URL/);
    expect(() => validateEnv({ ...base, APP_URL: 'https://support.example.com' })).toThrow(
      /REDIS_URL/,
    );

    const env = validateEnv({
      ...base,
      APP_URL: 'https://support.example.com',
      REDIS_URL: 'redis://:pw@redis:6379',
    });
    expect(env.APP_URL).toBe('https://support.example.com');
  });

  it('rejects mock models, placeholders and dev defaults in production', () => {
    const base = {
      NODE_ENV: 'production',
      APP_URL: 'https://support.example.com',
      REDIS_URL: 'redis://:pw@redis:6379',
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test',
      DATABASE_URL: 'postgres://user:secret@db:5432/support_agent',
      COMPANY_NAME: 'Support Agent',
    };

    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'mock' })).toThrow(/mock is not allowed/);
    expect(() =>
      validateEnv({
        ...base,
        CHATWOOT_WEBHOOK_SECRET: 'dev-webhook-0123456789abcdef0123456789abcdef',
      }),
    ).toThrow(/placeholder/);
    expect(() => validateEnv({ ...base, COMPANY_NAME: 'Acme Support' })).toThrow(/company name/);
    expect(() =>
      validateEnv({ ...base, DATABASE_URL: 'postgres://sa:sa@localhost:5432/support_agent' }),
    ).toThrow(/default development credentials/);
    expect(() => validateEnv({ ...base, CHATWOOT_WEBHOOK_SECRET: 'short' })).toThrow(/at least 32/);

    // The removed ALLOW_MOCK_LLM escape hatch cannot be smuggled back in.
    expect(() => validateEnv({ ...base, LLM_PROVIDER: 'mock', ALLOW_MOCK_LLM: 'true' })).toThrow(
      /mock is not allowed/,
    );
  });
});
