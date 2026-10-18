import { randomBytes } from 'node:crypto';

import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';

import { newPasswordSchema } from '@support-agent/shared';

import { users } from '../modules/auth/entities/user.entity';
import { PasswordService } from '../modules/auth/password.service';

/**
 * Creates (or updates) an admin user — the first login for a fresh install.
 *
 *   pnpm seed:admin -- --email admin@example.com [--name "Admin"] [--password ...]
 *
 * In a deployed container (compiled into the image, same schema — no tsx):
 *
 *   docker compose --env-file .env -f docker/docker-compose.prod.yml \
 *     run --rm api node dist/cli/seed-admin.js --email admin@example.com
 *
 * Without `--password` a random one is generated and printed once. Re-running
 * with an existing email updates the user (role → admin, new password).
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const emailRaw = flag('email');
  if (!emailRaw) {
    console.error(
      'Usage: pnpm seed:admin -- --email admin@example.com [--name "Admin"] [--password <12+ chars>]',
    );
    process.exitCode = 1;
    return;
  }

  const parsedEmail = z.email().safeParse(emailRaw);
  if (!parsedEmail.success) {
    console.error(`Invalid --email: ${emailRaw}`);
    process.exitCode = 1;
    return;
  }
  const email = parsedEmail.data;
  const name = flag('name') ?? 'Admin';

  let password = flag('password');
  let generated = false;
  if (password) {
    const parsed = newPasswordSchema.safeParse(password);
    if (!parsed.success) {
      console.error('Invalid --password: min 12 characters.');
      process.exitCode = 1;
      return;
    }
  } else {
    password = randomBytes(12).toString('base64url');
    generated = true;
  }

  const url = process.env.DATABASE_URL ?? 'postgres://sa:sa@localhost:5432/support_agent';
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client);
  const passwordHash = await new PasswordService().hash(password);

  try {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      await db
        .update(users)
        .set({ name, role: 'admin', isActive: true, passwordHash })
        .where(eq(users.id, existing.id));
      console.log(`Updated admin ${email}`);
    } else {
      await db.insert(users).values({ email, name, role: 'admin', passwordHash });
      console.log(`Created admin ${email}`);
    }

    if (generated) {
      console.log(`Password (shown once): ${password}`);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
