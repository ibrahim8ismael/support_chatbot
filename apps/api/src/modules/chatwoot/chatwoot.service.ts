import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';

const CHATWOOT_TIMEOUT_MS = 10_000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface ChatwootInbox {
  id: number;
  name: string;
  channelType: string | null;
}

/**
 * Chatwoot transport. All outbound API traffic stays here; webhook business
 * rules and answer generation belong to the agent module.
 */
@Injectable()
export class ChatwootService {
  private readonly baseUrl?: string;
  private readonly accountId: number;
  private readonly botClient?: AxiosInstance;
  private readonly accountClient?: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = config.get<string>('CHATWOOT_BASE_URL')?.replace(/\/$/, '');
    this.accountId = config.get<number>('CHATWOOT_ACCOUNT_ID') ?? 1;

    const botToken = config.get<string>('CHATWOOT_BOT_TOKEN');
    if (this.baseUrl && botToken) {
      this.botClient = axios.create({
        baseURL: `${this.baseUrl}/api/v1/accounts/${this.accountId}`,
        timeout: CHATWOOT_TIMEOUT_MS,
        headers: { api_access_token: botToken },
      });
    }

    const accountToken = config.get<string>('CHATWOOT_ACCOUNT_API_TOKEN');
    if (this.baseUrl && accountToken) {
      this.accountClient = axios.create({
        baseURL: `${this.baseUrl}/api/v1/accounts/${this.accountId}`,
        timeout: CHATWOOT_TIMEOUT_MS,
        headers: { api_access_token: accountToken },
      });
    }
  }

  get configuredAccountId(): number {
    return this.accountId;
  }

  /** Constant-time comparison of our separate secret URL path segment. */
  verifyWebhookSecret(secret: string): boolean {
    const expected = this.config.get<string>('CHATWOOT_WEBHOOK_SECRET');
    if (!expected) {
      return false;
    }

    const provided = createHash('sha256').update(secret).digest();
    const wanted = createHash('sha256').update(expected).digest();
    return timingSafeEqual(provided, wanted);
  }

  /**
   * Verify Chatwoot Agent Bot HMAC signatures (v4.13+). Older Chatwoot builds
   * can use the unguessable path secret; if a signature is sent without a
   * configured signing key, reject it instead of silently skipping validation.
   */
  verifyWebhookSignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    timestamp: string | undefined,
  ): boolean {
    const secret = this.config.get<string>('CHATWOOT_WEBHOOK_SIGNING_SECRET');
    if (!secret) {
      return !signature && !timestamp;
    }
    if (!rawBody || !signature || !timestamp || !/^\d+$/.test(timestamp)) {
      return false;
    }

    const timestampSeconds = Number(timestamp);
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS
    ) {
      return false;
    }

    const expected = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex')}`;
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');
    return (
      expectedBuffer.length === signatureBuffer.length &&
      timingSafeEqual(expectedBuffer, signatureBuffer)
    );
  }

  /** Account-level API token only: Agent Bot tokens cannot list account inboxes. */
  async listInboxes(): Promise<ChatwootInbox[]> {
    if (!this.accountClient) {
      throw new ServiceUnavailableException(
        'CHATWOOT_ACCOUNT_API_TOKEN and CHATWOOT_BASE_URL are required for inbox discovery',
      );
    }
    let response;
    try {
      response = await this.accountClient.get<unknown>('/inboxes');
    } catch {
      throw new BadGatewayException('Chatwoot inbox discovery request failed');
    }
    const body = isRecord(response.data) ? response.data : {};
    const payload = Array.isArray(body.payload) ? body.payload : [];
    return payload.flatMap((entry): ChatwootInbox[] => {
      const id = isRecord(entry) ? parsePositiveInteger(entry.id) : null;
      if (!isRecord(entry) || id === null || typeof entry.name !== 'string') {
        return [];
      }
      return [
        {
          id,
          name: entry.name,
          channelType: typeof entry.channel_type === 'string' ? entry.channel_type : null,
        },
      ];
    });
  }

  /** Post an outgoing customer reply or a private handoff note. */
  async sendMessage(
    conversationId: number,
    content: string,
    options: { private?: boolean } = {},
  ): Promise<number> {
    let response;
    try {
      response = await this.botApi().post<unknown>(`/conversations/${conversationId}/messages`, {
        content,
        message_type: 'outgoing',
        private: options.private ?? false,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadGatewayException('Chatwoot message request failed');
    }
    const body = isRecord(response.data) ? response.data : {};
    const messageId = parsePositiveInteger(body.id);
    if (messageId === null) {
      throw new BadGatewayException('Chatwoot message response did not include a valid id');
    }
    return messageId;
  }

  /** Add or remove a single label while preserving the conversation's others. */
  async setConversationLabel(
    conversationId: number,
    label: string,
    enabled: boolean,
  ): Promise<void> {
    const client = this.botApi();
    let response;
    try {
      response = await client.get<unknown>(`/conversations/${conversationId}/labels`);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadGatewayException('Chatwoot label lookup failed');
    }
    const current = labelsFromResponse(response.data);
    const labels = new Set(current);
    if (enabled) {
      labels.add(label);
    } else {
      labels.delete(label);
    }
    try {
      await client.post(`/conversations/${conversationId}/labels`, { labels: [...labels] });
    } catch {
      throw new BadGatewayException('Chatwoot label update failed');
    }
  }

  private botApi(): AxiosInstance {
    if (!this.botClient) {
      throw new ServiceUnavailableException(
        'CHATWOOT_BASE_URL and CHATWOOT_BOT_TOKEN are required for Chatwoot replies',
      );
    }
    return this.botClient;
  }
}

function labelsFromResponse(value: unknown): string[] {
  const body = isRecord(value) ? value : {};
  const raw = Array.isArray(body.payload)
    ? body.payload
    : Array.isArray(body.labels)
      ? body.labels
      : Array.isArray(value)
        ? value
        : [];
  return raw.flatMap((item): string[] => {
    if (typeof item === 'string') return [item];
    if (isRecord(item) && typeof item.title === 'string') return [item.title];
    return [];
  });
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
