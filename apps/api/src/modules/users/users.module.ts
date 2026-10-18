import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Users — user CRUD and role management (admin only). Imports `auth` for
 * password hashing and session invalidation; writes audit rows through
 * `analytics`.
 */
@Module({
  imports: [DatabaseModule, AuthModule, AnalyticsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
