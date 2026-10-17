import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { API_PREFIX } from '@support-agent/shared';

import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(AppLogger);
  app.useLogger(logger);

  // /health stays outside the prefix — Docker/compose healthchecks use it.
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });

  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get<string>('APP_URL'), credentials: true });
  app.enableShutdownHooks();

  // TODO(api): global zod validation pipe once the first dashboard endpoints land
  // (parse, don't trust — repo-structure.md conventions).

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
