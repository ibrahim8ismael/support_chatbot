import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { InfraModule } from '../infra/infra.module';
import { BindingsController } from './bindings.controller';
import { BindingsService } from './bindings.service';

/**
 * Bindings — owns `inbox_bindings`. Per-inbox KB lists are cached in Redis
 * (60 s, busted on write) because the webhook filter reads them per message.
 */
@Module({
  imports: [DatabaseModule, InfraModule],
  controllers: [BindingsController],
  providers: [BindingsService],
  exports: [BindingsService],
})
export class BindingsModule {}
