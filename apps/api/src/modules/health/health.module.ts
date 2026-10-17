import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../db/database.module';
import { InfraModule } from '../infra/infra.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [DatabaseModule, InfraModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
