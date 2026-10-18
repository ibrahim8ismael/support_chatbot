import 'reflect-metadata';

import { join } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Applies the forward-only Drizzle migrations — the `migrate` one-shot
 * container that runs before `api` on deploy
 * (docs/operations/deployment.md § Deploy & migrate).
 *
 * The SQL ships inside dist (nest-cli.json assets), so the same command works
 * in dev (`tsx src/cli/migrate.ts`) and in the production image
 * (`node dist/cli/migrate.js`). Re-running is a no-op: the migrator tracks
 * applied migrations in `drizzle.__drizzle_migrations`.
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? 'postgres://sa:sa@localhost:5432/support_agent';
  const client = postgres(url, { max: 1, onnotice: () => undefined });

  try {
    await migrate(drizzle(client), {
      migrationsFolder: join(__dirname, '..', 'db', 'migrations'),
    });
    console.log('Migrations applied — drizzle journal is up to date.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
