import { Module } from '@nestjs/common';

import { BindingsService } from './bindings.service';

@Module({
  providers: [BindingsService],
  exports: [BindingsService],
})
export class BindingsModule {}
