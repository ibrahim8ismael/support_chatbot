import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/**
 * pino-backed Nest LoggerService — structured JSON logs.
 * Redaction list covers credentials per docs/operations/security.md: never log
 * authorization headers, cookies, tokens, or API keys.
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor() {
    this.logger = pino({
      level: process.env.LOG_LEVEL ?? 'info',
      redact: {
        paths: [
          'authorization',
          'req.headers.authorization',
          'req.headers.cookie',
          'token',
          'api_key',
          'apiKey',
          'password',
        ],
        censor: '[redacted]',
      },
    });
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, context?: string): void {
    this.write('error', message, context);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  private write(level: Level, message: unknown, context?: string): void {
    const payload: Record<string, unknown> = { context: context ?? 'App' };
    let text: string | undefined;

    if (message instanceof Error) {
      payload.err = message;
      text = message.message;
    } else if (typeof message === 'string') {
      text = message;
    } else if (message !== undefined) {
      payload.data = message;
    }

    this.logger[level](payload, text);
  }
}
