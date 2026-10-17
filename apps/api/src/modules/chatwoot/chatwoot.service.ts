import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Chatwoot integration — the only module allowed to talk to the Chatwoot API
 * (docs/integrations/chatwoot.md). Stores channel ids on conversations; owns no
 * tables.
 *
 * TODO(chatwoot): axios instance with timeout + logging interceptors
 * (repo-structure.md conventions), then:
 *  - sendMessage(), addPrivateNote(), addLabel()
 *  - webhook payload parsing (zod) against anonymized captured fixtures
 */
@Injectable()
export class ChatwootService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Constant-time compare of the webhook path secret. Wrong secret → 404, never
   * 401 — never confirm the endpoint exists (docs/api/rest-api.md).
   */
  verifyWebhookSecret(secret: string): boolean {
    const expected = this.config.get<string>('CHATWOOT_WEBHOOK_SECRET');
    if (!expected) {
      return false;
    }

    const provided = createHash('sha256').update(secret).digest();
    const wanted = createHash('sha256').update(expected).digest();
    return timingSafeEqual(provided, wanted);
  }
}
