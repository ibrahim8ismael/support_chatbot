import { Global, Module } from '@nestjs/common';

import { AppLogger } from './app-logger.service';

/** Logging is ambient — every module may inject AppLogger without importing this. */
@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
