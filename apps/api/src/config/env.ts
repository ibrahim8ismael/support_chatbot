import { z } from 'zod';

/** Treat empty env values ("VAR=") as unset. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    schema.optional(),
  );

/**
 * Every environment variable the API understands — mirrors
 * docs/operations/deployment.md § Environment variables. Validated at boot:
 * the API refuses to start with bad/missing env (fail fast, not at 3 AM).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Dashboard origin: cookies/CORS + cross-site request checks. Required in production. */
    APP_URL: optional(z.url()),
    PORT: z.coerce.number().int().positive().default(3001),

    DATABASE_URL: z.string().min(1).default('postgres://sa:sa@localhost:5432/support_agent'),
    /** Required in production — a defaulted value would point at localhost. */
    REDIS_URL: optional(z.string().min(1)),

    CHATWOOT_BASE_URL: optional(z.url()),
    CHATWOOT_ACCOUNT_ID: optional(z.coerce.number().int().positive()),
    CHATWOOT_BOT_TOKEN: optional(z.string().min(1)),
    CHATWOOT_WEBHOOK_SECRET: optional(z.string().min(8)),

    LLM_PROVIDER: z.enum(['openai', 'openrouter', 'gemini', 'mock']).default('mock'),
    OPENAI_API_KEY: optional(z.string().min(1)),
    /** Chat via OpenRouter; embeddings stay with OpenAI (D3). */
    OPENROUTER_API_KEY: optional(z.string().min(1)),
    /** Chat via Google Gemini; embeddings stay with OpenAI (D3). */
    GEMINI_API_KEY: optional(z.string().min(1)),
    /** Alias accepted by @ai-sdk/google; `GEMINI_API_KEY` wins when both are set. */
    GOOGLE_GENERATIVE_AI_API_KEY: optional(z.string().min(1)),
    EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    /** Optional; each provider has a sensible default in the factory. */
    CHAT_MODEL: optional(z.string().min(1)),
    /** Substituted into the answer prompt's `{{company_name}}`. */
    COMPANY_NAME: z.string().min(1).max(120).default('Acme Support'),

    /** Global daily cap on paid dashboard AI requests (playground/search); 0 disables. */
    LLM_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(0).default(3000),

    /** Weekly top-unanswered digest webhook (T-305); unset = logged, not posted. */
    DIGEST_WEBHOOK_URL: optional(z.url()),

    /** NFR-7: messages/events retention window; documents live until deleted. */
    RETENTION_DAYS: z.coerce.number().int().min(1).default(365),

    /** T-404 ops channel (Slack-compatible `{"text": …}`); unset = warn-log alerts. */
    ALERT_WEBHOOK_URL: optional(z.url()),
    ALERT_COOLDOWN_MINUTES: z.coerce.number().int().min(1).default(30),
    /** Fallback Redis memory cap when `maxmemory` is unset (ADR-0006: 512 MB box). */
    ALERT_REDIS_MEMORY_MB: z.coerce.number().int().min(1).default(460),

    UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  })
  .superRefine((env, ctx) => {
    // Which keys each provider needs. OpenRouter and Gemini need OpenAI too:
    // embeddings are always `text-embedding-3-small` (D3) — both serve chat only.
    const requiredKeys: Record<string, string[]> = {
      openai: ['OPENAI_API_KEY'],
      openrouter: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
      gemini: ['OPENAI_API_KEY'],
      mock: [],
    };

    for (const key of requiredKeys[env.LLM_PROVIDER] ?? []) {
      if (!env[key as keyof typeof env]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `required when LLM_PROVIDER=${env.LLM_PROVIDER}`,
        });
      }
    }

    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY && !env.GOOGLE_GENERATIVE_AI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'required when LLM_PROVIDER=gemini (or set GOOGLE_GENERATIVE_AI_API_KEY)',
      });
    }

    if (env.NODE_ENV !== 'production') {
      return;
    }

    // Production must name its own origins: a silently-defaulted APP_URL would
    // break cookies/CORS, a defaulted REDIS_URL would point at localhost.
    for (const key of ['APP_URL', 'REDIS_URL'] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'must be set explicitly in production (no default is applied)',
        });
      }
    }

    // Production is for real models and real secrets — never copied templates.
    if (env.LLM_PROVIDER === 'mock') {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message:
          'mock is not allowed in production — set LLM_PROVIDER=openai, openrouter, or gemini (real provider keys required)',
      });
    }

    const placeholder = /change[-_]?me|dev-only|dev-webhook|placeholder|example/i;
    if (
      typeof env.CHATWOOT_WEBHOOK_SECRET === 'string' &&
      placeholder.test(env.CHATWOOT_WEBHOOK_SECRET)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['CHATWOOT_WEBHOOK_SECRET'],
        message: 'placeholder value — generate a real secret (openssl rand -hex 32)',
      });
    }

    if (env.CHATWOOT_WEBHOOK_SECRET && env.CHATWOOT_WEBHOOK_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['CHATWOOT_WEBHOOK_SECRET'],
        message: 'must be at least 32 characters in production',
      });
    }

    if (env.COMPANY_NAME === 'Acme Support') {
      ctx.addIssue({
        code: 'custom',
        path: ['COMPANY_NAME'],
        message: 'set your product/company name (the default is a development placeholder)',
      });
    }

    if (/sa:sa@/.test(env.DATABASE_URL)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'default development credentials are not allowed in production',
      });
    }
  })
  .transform((env) => ({
    ...env,
    APP_URL: env.APP_URL ?? 'http://localhost:3000',
    REDIS_URL: env.REDIS_URL ?? 'redis://localhost:6379',
  }));

export type Env = z.infer<typeof envSchema>;

/** `ConfigModule.forRoot({ validate })` hook — throws with a readable report. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
