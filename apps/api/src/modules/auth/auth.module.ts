import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { DatabaseModule } from '../../db/database.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InfraModule } from '../infra/infra.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';

/**
 * Auth — owns `users` and `sessions` (argon2id hashes, server-side sessions).
 * Registers the global guards: AuthGuard (session → request.user, `@Public()`
 * to skip) runs first, then RolesGuard (default admin — security doc § 2).
 * Login attempts and logouts are audited through the analytics writer (T-301).
 */
@Module({
  imports: [DatabaseModule, InfraModule, AnalyticsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
