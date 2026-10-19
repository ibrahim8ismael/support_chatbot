import { config as loadEnv } from 'dotenv';

/**
 * Posts a synthetic Chatwoot webhook to the local API —
 * see docs/contributing/development.md § Testing with a live Chatwoot.
 *
 *   pnpm simulate:webhook [-- --conversation 812]
 *
 * Expected responses while the pipeline is a stub (T-201): correct secret →
 * `501 {"status":"not_implemented"}`; wrong secret → `404`. No replies happen.
 *
 * TODO(chatwoot): replace the inline payload with anonymized captured fixtures
 * (apps/api/test/fixtures/) once the webhook schema is implemented.
 */
loadEnv({ path: ['.env.local', '.env'], quiet: true });

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const port = process.env.PORT ?? '3001';
  const secret = process.env.CHATWOOT_WEBHOOK_SECRET ?? 'dev-webhook-secret';
  const conversationId = Number(argValue('--conversation') ?? 812);
  const url = `http://localhost:${port}/api/webhooks/chatwoot/${secret}`;

  // Minimal stand-in for a `message_created` event (docs/integrations/chatwoot.md).
  const payload = {
    event: 'message_created',
    account: { id: Number(process.env.CHATWOOT_ACCOUNT_ID ?? '1') },
    conversation: { id: conversationId, inbox_id: 1, status: 'open' },
    id: Math.floor(Date.now() / 1000),
    message_type: 'incoming',
    content: 'What does the annual plan cost?',
    sender: { id: 1, name: 'Test Contact', type: 'contact' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(`${response.status} ${response.statusText} — ${url}`);
  console.log(await response.text());
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
