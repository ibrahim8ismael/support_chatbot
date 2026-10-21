import { config as loadEnv } from 'dotenv';
import { createHmac } from 'node:crypto';

/**
 * Posts a synthetic Chatwoot webhook to the local API —
 * see docs/contributing/development.md § Testing with a live Chatwoot.
 *
 *   pnpm simulate:webhook [-- --conversation 812]
 *
 * The event is queued and may produce a reply if its inbox is enabled/bound
 * and the global bot switch is on. Use a test conversation and inbox.
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'refusing to send synthetic webhooks with NODE_ENV=production — point this at a local/dev API',
    );
  }

  const port = process.env.PORT ?? '3001';
  const secret = process.env.CHATWOOT_WEBHOOK_SECRET ?? 'dev-webhook-secret';
  const conversationId = Number(argValue('--conversation') ?? 812);
  const inboxId = Number(argValue('--inbox') ?? 1);
  const url = `http://localhost:${port}/api/webhooks/chatwoot/${secret}`;

  // Minimal stand-in for a `message_created` event (docs/integrations/chatwoot.md).
  const payload = {
    event: 'message_created',
    account: { id: Number(process.env.CHATWOOT_ACCOUNT_ID ?? '1') },
    conversation: { id: conversationId, inbox_id: inboxId, status: 'open' },
    id: Date.now(),
    message_type: 'incoming',
    content_type: 'text',
    private: false,
    created_at: new Date().toISOString(),
    content: 'What does the annual plan cost?',
    sender: { id: 1, name: 'Test Contact', type: 'contact' },
  };
  const rawBody = JSON.stringify(payload);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const signingSecret = process.env.CHATWOOT_WEBHOOK_SIGNING_SECRET;
  if (signingSecret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers['x-chatwoot-timestamp'] = timestamp;
    headers['x-chatwoot-signature'] = `sha256=${createHmac('sha256', signingSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex')}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: rawBody,
  });

  console.log(`${response.status} ${response.statusText} — ${url}`);
  console.log(await response.text());
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
