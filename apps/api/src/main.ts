import 'reflect-metadata';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { API_PREFIX } from '@support-agent/shared';

import { AppModule } from './app.module';
import { AppLogger } from './common/logger/app-logger.service';
import { csrfOriginMiddleware } from './common/middleware/csrf-origin';
import { resolveChatModel } from './modules/llm/providers/provider.defaults';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(AppLogger);
  app.useLogger(logger);

  // Session cookie parsing for AuthGuard (docs/operations/security.md § 1).
  app.use(cookieParser());

  // /health stays outside the prefix — Docker/compose healthchecks use it.
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });

  const config = app.get(ConfigService);
  // Cross-site write guard (audit P3) — SameSite=Lax plus an Origin check.
  app.use(csrfOriginMiddleware(config.getOrThrow<string>('APP_URL')));
  app.enableCors({ origin: config.get<string>('APP_URL'), credentials: true });
  app.enableShutdownHooks();

  // Behind the prod compose Caddy: exactly one proxy hop, so `request.ip` is
  // the client. Without this, per-IP login limiting collapses into one bucket.
  (app.getHttpAdapter().getInstance() as { set: (key: string, value: number) => void }).set(
    'trust proxy',
    1,
  );

  // Make the active model set loud at boot — a silent mock fallback is the
  // worst failure mode (env.ts rejects mock mode in production outright).
  const provider = config.get<string>('LLM_PROVIDER');
  if (provider === 'mock') {
    logger.warn(
      'LLM_PROVIDER=mock — fake models, no external calls; never for customer traffic',
      'Bootstrap',
    );
  } else {
    const chatModel = resolveChatModel(provider ?? 'mock', config.get<string>('CHAT_MODEL'));
    logger.log(
      `LLM provider "${provider}" (chat ${chatModel}, embeddings ${config.get<string>('EMBEDDING_MODEL')})`,
      'Bootstrap',
    );
  }

  // TODO(api): global zod validation pipe once the first dashboard endpoints land
  // (parse, don't trust — repo-structure.md conventions).

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
  logger.log(`API listening on http://localhost:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
