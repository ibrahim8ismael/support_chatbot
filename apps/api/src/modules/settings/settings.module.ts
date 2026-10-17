import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { InfraModule } from '../infra/infra.module';
import { LlmModule } from '../llm/llm.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Settings — owns the `settings` key/value table. Reads are cached in Redis
 * (60 s, busted on write); secrets stay in env (docs/operations/security.md).
 */
@Module({
  imports: [DatabaseModule, InfraModule, LlmModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
