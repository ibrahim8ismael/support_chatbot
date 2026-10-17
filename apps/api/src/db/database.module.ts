import { Module } from '@nestjs/common';

import { DatabaseService } from './database.service';

/**
 * Shared DB plumbing (src/db — not a domain module; see the module table in
 * docs/architecture/repo-structure.md). Import it wherever the DB is needed.
 */
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
