import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

loadEnv({ path: ['.env.local', '.env'], quiet: true });

export default defineConfig({
  // Every module owns its tables and re-exports them via src/db/schema.ts.
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://sa:sa@localhost:5432/support_agent',
  },
});
