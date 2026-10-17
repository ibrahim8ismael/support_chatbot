import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

/**
 * Shared Postgres access: one postgres.js client + Drizzle instance.
 * Modules keep their tables in their own `entities/` and inject this service —
 * they never open their own connections.
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: ReturnType<typeof postgres>;
  readonly db: PostgresJsDatabase;

  constructor(config: ConfigService) {
    this.client = postgres(config.getOrThrow<string>('DATABASE_URL'), {
      max: 10,
      onnotice: () => undefined,
    });
    this.db = drizzle(this.client);
  }

  /** Shallow liveness probe for /health. */
  async ping(): Promise<void> {
    await this.client`select 1`;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
