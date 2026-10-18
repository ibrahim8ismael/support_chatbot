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
    APP_URL: z.url().default('http://localhost:3000'),
    PORT: z.coerce.number().int().positive().default(3001),

    DATABASE_URL: z.string().min(1).default('postgres://sa:sa@localhost:5432/support_agent'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

    AUTH_SESSION_SECRET: z.string().min(32),

    CHATWOOT_BASE_URL: optional(z.url()),
    CHATWOOT_ACCOUNT_ID: optional(z.coerce.number().int().positive()),
    CHATWOOT_BOT_TOKEN: optional(z.string().min(1)),
    CHATWOOT_WEBHOOK_SECRET: optional(z.string().min(8)),

    LLM_PROVIDER: z.enum(['openai', 'openrouter', 'mock']).default('mock'),
    OPENAI_API_KEY: optional(z.string().min(1)),
    /** Chat via OpenRouter; embeddings stay with OpenAI (D3). */
    OPENROUTER_API_KEY: optional(z.string().min(1)),
    EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
    CHAT_MODEL: z.string().min(1).default('gpt-4.1-mini'),
    /** Substituted into the answer prompt's `{{company_name}}`. */
    COMPANY_NAME: z.string().min(1).max(120).default('Acme Support'),

    /** Weekly top-unanswered digest webhook (T-305); unset = logged, not posted. */
    DIGEST_WEBHOOK_URL: optional(z.url()),

    UPLOAD_DIR: z.string().min(1).default('./data/uploads'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  })
  .superRefine((env, ctx) => {
    // Which keys each provider needs. openrouter needs OpenAI too: embeddings
    // are always `text-embedding-3-small` (D3) — OpenRouter serves chat only.
    const requiredKeys: Record<string, string[]> = {
      openai: ['OPENAI_API_KEY'],
      openrouter: ['OPENROUTER_API_KEY', 'OPENAI_API_KEY'],
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
  });

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
