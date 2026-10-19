import { exec as execCallback } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import { Queue, Worker } from 'bullmq';
import { config as loadEnv } from 'dotenv';
import Redis from 'ioredis';

import { REDIS_DB_QUEUE, SESSION_COOKIE_NAME } from '@support-agent/shared';

import { redisOptions } from '../src/modules/infra/redis-options';
import {
  ACK_P95_LIMIT_MS,
  E2E_P95_LIMIT_MS,
  LOAD_SMOKE_JOB_DEFAULTS,
  LOAD_SMOKE_QUEUE,
  LOAD_SMOKE_QUESTIONS,
  RETRIEVAL_P95_LIMIT_MS,
  buildChatwootWebhookPayload,
  evaluate,
  findRepoRoot,
  formatEvaluation,
  isLocalHost,
  mapConcurrent,
  maskRedisUrl,
} from './load-smoke.helpers';

/**
 * T-402 load + latency smoke (NFR-1/2/8) — run against any deployment:
 *
 *   pnpm --filter api load:smoke -- --email ops@company.com --password '…'
 *
 *   1. webhook ack: `--webhook-burst` synthetic `message_created` events at
 *      `--concurrency` (default 100 @ 20 — the NFR-8 bursts; the 5k
 *      conversations/month average is ~7/h). Asserts the documented status
 *      (501 while the reply pipeline is a stub — T-201; 2xx afterwards) and
 *      p95 ≤ 300 ms.
 *   2. pipeline latency: `--pipeline-count` playground asks through the full
 *      answer path against a throwaway KB (`--kb <uuid>` to reuse a populated
 *      one; KB create/delete needs an admin account). Asserts p95 ≤ 15 s and
 *      retrieval p95 ≤ 500 ms — meaningful only with a real provider key;
 *      under `LLM_PROVIDER=mock` it is a plumbing check.
 *   3. queue durability: `--jobs` jobs on the dedicated `load-smoke` queue
 *      (ADR-0006 defaults), Redis restarted mid-flight (default: dev compose;
 *      `--restart-cmd` for other hosts, `--skip-restart` for managed Redis),
 *      then asserts nothing was lost and every job completes.
 *
 * Exits non-zero on any assertion failure — usable as an ops gate. Safe on a
 * production host: it never touches real queues (see LOAD_SMOKE_QUEUE) and the
 * burst cannot write mock traffic into a live inbox — against non-local
 * targets the script checks the target inbox's bindings and refuses an
 * enabled (bound) inbox, or anything it cannot verify, unless
 * `--allow-live-burst` is passed explicitly (assertBurstTargetSafe below).
 *
 * `--insecure` accepts self-signed certs (e.g. Caddy's internal CA).
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

const exec = promisify(execCallback);
const REQUEST_TIMEOUT_MS = 30_000;
const REDIS_RESTART_WAIT_MS = 60_000;
const DRAIN_WAIT_MS = 60_000;

interface CliOptions {
  baseUrl: string;
  secret: string;
  accountId: number;
  inboxId: number;
  email?: string;
  password?: string;
  kbId?: string;
  burst: number;
  pipelines: number;
  concurrency: number;
  jobs: number;
  restartCmd?: string;
  skipRestart: boolean;
  skipPipeline: boolean;
  insecure: boolean;
  allowLiveBurst: boolean;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number (got "${raw}")`);
  }
  return parsed;
}

function parseArgs(): CliOptions {
  const port = process.env.PORT ?? '3001';
  return {
    baseUrl: argValue('--base-url') ?? `http://localhost:${port}`,
    secret:
      argValue('--webhook-secret') ?? process.env.CHATWOOT_WEBHOOK_SECRET ?? 'dev-webhook-secret',
    accountId: Number(argValue('--account') ?? process.env.CHATWOOT_ACCOUNT_ID ?? '1'),
    inboxId: Number(argValue('--inbox') ?? '1'),
    email: argValue('--email'),
    password: argValue('--password'),
    kbId: argValue('--kb'),
    burst: numberArg('--webhook-burst', 100),
    pipelines: numberArg('--pipeline-count', 20),
    concurrency: numberArg('--concurrency', 20),
    jobs: numberArg('--jobs', 50),
    restartCmd: argValue('--restart-cmd'),
    skipRestart: process.argv.includes('--skip-restart'),
    skipPipeline: process.argv.includes('--skip-pipeline'),
    insecure: process.argv.includes('--insecure'),
    allowLiveBurst: process.argv.includes('--allow-live-burst'),
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function apiFetch(
  options: CliOptions,
  path: string,
  init: { method: string; cookie?: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return fetch(`${options.baseUrl}${path}`, {
    method: init.method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function login(options: CliOptions): Promise<string> {
  const response = await apiFetch(options, '/api/auth/login', {
    method: 'POST',
    body: { email: options.email, password: options.password },
  });
  if (!response.ok) {
    throw new Error(`login failed for ${options.email}: HTTP ${response.status}`);
  }
  const setCookies = response.headers.getSetCookie();
  const session = setCookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!session) throw new Error('login succeeded but no session cookie was set');
  return session.split(';')[0] ?? session;
}

// --- Phase 1: webhook ack ---------------------------------------------------

interface WebhookPhase {
  evaluation: ReturnType<typeof evaluate> | null;
  failed: number;
  firstStatus: number;
  warmup: number;
}

/**
 * The webhook burst must never create mock traffic on a live inbox. Localhost
 * is always fine; remote targets are refused when the target inbox has an
 * enabled binding (once T-201 lands, synthetic `message_created` events would
 * become real conversations and bot replies). Targets we cannot verify fail
 * closed; `--allow-live-burst` is the deliberate override for drills.
 */
async function assertBurstTargetSafe(options: CliOptions): Promise<void> {
  if (isLocalHost(options.baseUrl)) {
    return;
  }
  if (options.allowLiveBurst) {
    console.warn(
      `warning: webhook burst against ${options.baseUrl} allowed via --allow-live-burst`,
    );
    return;
  }
  if (!options.email || !options.password) {
    throw new Error(
      `refusing the webhook burst against non-local ${options.baseUrl}: pass --email/--password so the target inbox's bindings can be checked, or --allow-live-burst to override`,
    );
  }

  const cookie = await login(options);
  const response = await apiFetch(options, '/api/bindings', { method: 'GET', cookie });
  if (!response.ok) {
    throw new Error(
      `refusing the webhook burst: could not read bindings from ${options.baseUrl} (HTTP ${response.status}) — pass --allow-live-burst to override`,
    );
  }
  const bindings = (await response.json()) as Array<{
    chatwootInboxId?: number;
    enabled?: boolean;
  }>;
  const bound = bindings.some(
    (binding) => binding.chatwootInboxId === options.inboxId && binding.enabled === true,
  );
  if (bound) {
    throw new Error(
      `refusing the webhook burst: inbox ${options.inboxId} has an enabled binding on ${options.baseUrl} — synthetic events would produce real conversations/replies once the pipeline lands; use an unbound test inbox or pass --allow-live-burst`,
    );
  }
}

async function runWebhookBurst(options: CliOptions): Promise<WebhookPhase> {
  await assertBurstTargetSafe(options);
  const payloads = Array.from({ length: options.burst }, (_, index) =>
    buildChatwootWebhookPayload(index, { accountId: options.accountId, inboxId: options.inboxId }),
  );

  // Prime the HTTP pool + server before measuring — a cold first burst in a
  // fresh process measures connection setup and JIT warm-up, not the handler.
  const warmup = Math.min(10, options.burst);
  if (warmup > 0) {
    await mapConcurrent(
      payloads.slice(0, warmup),
      Math.min(5, options.concurrency),
      async (payload) => {
        try {
          await apiFetch(options, `/api/webhooks/chatwoot/${options.secret}`, {
            method: 'POST',
            body: payload,
          });
        } catch {
          // warm-up only — the measured burst reports real failures
        }
      },
    );
  }

  const outcomes = await mapConcurrent(payloads, options.concurrency, async (payload) => {
    const started = performance.now();
    try {
      const response = await apiFetch(options, `/api/webhooks/chatwoot/${options.secret}`, {
        method: 'POST',
        body: payload,
      });
      // The stub answers 501 by design until T-201; the pipeline flips this to 2xx.
      const ok = response.status === 501 || response.ok;
      return { ok, status: response.status, ms: performance.now() - started };
    } catch {
      return { ok: false, status: 0, ms: performance.now() - started };
    }
  });
  const ok = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok);
  return {
    evaluation:
      ok.length > 0
        ? evaluate(
            'webhook ack',
            ok.map((outcome) => outcome.ms),
            ACK_P95_LIMIT_MS,
          )
        : null,
    failed: failed.length,
    firstStatus: failed[0]?.status ?? 0,
    warmup,
  };
}

// --- Phase 2: pipeline latency ---------------------------------------------

interface PipelinePhase {
  e2e: ReturnType<typeof evaluate>;
  retrieval: ReturnType<typeof evaluate> | null;
  failed: number;
  kbId: string;
  createdKb: boolean;
}

async function runPipelineLatency(options: CliOptions): Promise<PipelinePhase> {
  const cookie = await login(options);

  let kbId = options.kbId;
  let createdKb = false;
  if (!kbId) {
    const created = await apiFetch(options, '/api/knowledge-bases', {
      method: 'POST',
      cookie,
      body: { name: `load-smoke ${new Date().toISOString()}` },
    });
    if (!created.ok) throw new Error(`KB create failed: HTTP ${created.status}`);
    const body = (await created.json()) as { id?: string };
    if (!body.id) throw new Error('KB create returned no id');
    kbId = body.id;
    createdKb = true;
  }

  try {
    const questions = Array.from(
      { length: options.pipelines },
      (_, index) => LOAD_SMOKE_QUESTIONS[index % LOAD_SMOKE_QUESTIONS.length] ?? 'Load smoke',
    );
    const outcomes = await mapConcurrent(questions, options.concurrency, async (question) => {
      const started = performance.now();
      try {
        const response = await apiFetch(options, '/api/playground/ask', {
          method: 'POST',
          cookie,
          body: { question, kbIds: [kbId] },
        });
        if (!response.ok) return { ok: false, e2e: performance.now() - started, retrieval: NaN };
        const answer = (await response.json()) as {
          latency?: { totalMs?: number; retrievalMs?: number };
        };
        return {
          ok: true,
          e2e: answer.latency?.totalMs ?? performance.now() - started,
          retrieval: answer.latency?.retrievalMs ?? NaN,
        };
      } catch {
        return { ok: false, e2e: performance.now() - started, retrieval: NaN };
      }
    });
    const ok = outcomes.filter((outcome) => outcome.ok);
    if (ok.length === 0) throw new Error('every playground ask failed');
    const retrievals = ok.map((outcome) => outcome.retrieval).filter(Number.isFinite);
    return {
      e2e: evaluate(
        'pipeline e2e',
        ok.map((outcome) => outcome.e2e),
        E2E_P95_LIMIT_MS,
      ),
      retrieval:
        retrievals.length > 0 ? evaluate('retrieval', retrievals, RETRIEVAL_P95_LIMIT_MS) : null,
      failed: outcomes.length - ok.length,
      kbId,
      createdKb,
    };
  } finally {
    if (createdKb && kbId) {
      const deleted = await apiFetch(options, `/api/knowledge-bases/${kbId}`, {
        method: 'DELETE',
        cookie,
      }).catch(() => null);
      if (!deleted?.ok) console.warn(`warning: could not delete throwaway KB ${kbId}`);
    }
  }
}

// --- Phase 3: queue durability ---------------------------------------------

interface QueuePhase {
  enqueued: number;
  afterRestart: number;
  lost: number;
  completed: number;
  failed: number;
  restartMs: number | null;
}

const sumCounts = (counts: Record<string, number>) =>
  Object.values(counts).reduce((total, count) => total + count, 0);

async function waitForRedis(redisUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const client = new Redis({
      ...redisOptions(redisUrl, REDIS_DB_QUEUE),
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on('error', () => undefined); // connect failures are expected here — retried below
    try {
      await client.connect();
      if ((await client.ping()) === 'PONG') {
        client.disconnect();
        return;
      }
    } catch {
      // redis is still coming back — retry below
    }
    client.disconnect();
    if (Date.now() > deadline) {
      throw new Error(`redis did not accept connections within ${timeoutMs} ms after restart`);
    }
    await delay(500);
  }
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) return false;
    await delay(250);
  }
}

async function runQueueDurability(options: CliOptions): Promise<QueuePhase> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const clients: Redis[] = [];
  const makeClient = (): Redis => {
    const client = new Redis({
      ...redisOptions(redisUrl, REDIS_DB_QUEUE),
      maxRetriesPerRequest: null,
    });
    client.on('error', () => undefined); // connection noise during the restart window
    clients.push(client);
    return client;
  };

  const runId = Date.now().toString(36);
  const jobIds = Array.from({ length: options.jobs }, (_, index) => `${runId}-${index}`);

  try {
    let queue = new Queue(LOAD_SMOKE_QUEUE, { connection: makeClient() });
    await queue.obliterate({ force: true });
    await queue.addBulk(
      jobIds.map((jobId, index) => ({
        name: LOAD_SMOKE_QUEUE,
        data: { jobId, index },
        opts: { jobId, ...LOAD_SMOKE_JOB_DEFAULTS },
      })),
    );
    const enqueued = sumCounts(await queue.getJobCounts('waiting', 'delayed', 'active'));
    await queue.close();

    let restartMs: number | null = null;
    if (!options.skipRestart) {
      const repoRoot = findRepoRoot(process.cwd());
      if (!options.restartCmd && !repoRoot) {
        throw new Error('repo root not found for the default restart command — pass --restart-cmd');
      }
      const command =
        options.restartCmd ?? 'docker compose -f docker/docker-compose.yml restart redis';
      const started = performance.now();
      await exec(command, repoRoot ? { cwd: repoRoot } : undefined);
      await waitForRedis(redisUrl, REDIS_RESTART_WAIT_MS);
      restartMs = performance.now() - started;
    }

    queue = new Queue(LOAD_SMOKE_QUEUE, { connection: makeClient() });
    const afterRestart = sumCounts(
      await queue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed'),
    );

    // Drain with a throwaway consumer (this queue only): once the real reply
    // worker exists (T-203), it may drain first — the assertion is the same.
    const worker = new Worker(LOAD_SMOKE_QUEUE, async () => undefined, {
      connection: makeClient(),
      concurrency: Math.min(10, options.jobs),
    });
    await waitUntil(async () => {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
      );
      return (counts.completed ?? 0) + (counts.failed ?? 0) >= options.jobs;
    }, DRAIN_WAIT_MS);
    const finalCounts = await queue.getJobCounts('completed', 'failed');
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();

    return {
      enqueued,
      afterRestart,
      lost: enqueued - afterRestart,
      completed: finalCounts.completed ?? 0,
      failed: finalCounts.failed ?? 0,
      restartMs,
    };
  } finally {
    // ioredis instances passed to BullMQ are ours to dispose — a live
    // reconnect loop would otherwise keep the process from ever exiting.
    for (const client of clients) client.disconnect();
  }
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const options = parseArgs();
  if (options.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const failures: string[] = [];
  console.log(`load smoke → ${options.baseUrl}`);
  console.log(
    `  burst: ${options.burst} webhooks @ ${options.concurrency} concurrent ` +
      `(NFR-8: ≤ 20 concurrent; 5k conversations/month ≈ 7/h average)`,
  );

  console.log('\n[1/3] webhook ack …');
  const webhook = await runWebhookBurst(options);
  if (webhook.evaluation) console.log(`  ${formatEvaluation(webhook.evaluation)}`);
  if (webhook.warmup > 0) {
    console.log(`  (warm-up: ${webhook.warmup} requests, not measured)`);
  }
  if (webhook.failed > 0) {
    failures.push(
      `webhook burst: ${webhook.failed}/${options.burst} requests failed ` +
        `(first: ${webhook.firstStatus === 0 ? 'network error' : `HTTP ${webhook.firstStatus}`})`,
    );
  }
  if (webhook.evaluation && !webhook.evaluation.pass) {
    failures.push(
      `webhook ack p95 ${webhook.evaluation.p95.toFixed(1)} ms > ${ACK_P95_LIMIT_MS} ms`,
    );
  }

  console.log('\n[2/3] pipeline latency …');
  if (options.skipPipeline || !options.email || !options.password) {
    console.log(
      `  skipped (${options.skipPipeline ? '--skip-pipeline' : 'pass --email/--password to enable'})`,
    );
  } else {
    try {
      const pipeline = await runPipelineLatency(options);
      console.log(`  ${formatEvaluation(pipeline.e2e)}`);
      if (pipeline.retrieval) console.log(`  ${formatEvaluation(pipeline.retrieval)}`);
      if (pipeline.createdKb) {
        console.log(`  (throwaway KB ${pipeline.kbId} created and deleted)`);
      }
      if (pipeline.failed > 0) {
        failures.push(`pipeline: ${pipeline.failed}/${options.pipelines} asks failed`);
      }
      if (!pipeline.e2e.pass) {
        failures.push(
          `pipeline e2e p95 ${pipeline.e2e.p95.toFixed(1)} ms > ${E2E_P95_LIMIT_MS} ms`,
        );
      }
      if (pipeline.retrieval && !pipeline.retrieval.pass) {
        failures.push(
          `retrieval p95 ${pipeline.retrieval.p95.toFixed(1)} ms > ${RETRIEVAL_P95_LIMIT_MS} ms`,
        );
      }
    } catch (error) {
      failures.push(`pipeline phase: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n[3/3] queue durability …');
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  console.log(`  redis: ${maskRedisUrl(redisUrl)} (db ${REDIS_DB_QUEUE})`);
  try {
    const queuePhase = await runQueueDurability(options);
    console.log(
      `  enqueued=${queuePhase.enqueued} after-restart=${queuePhase.afterRestart} ` +
        `lost=${queuePhase.lost} completed=${queuePhase.completed} failed=${queuePhase.failed}` +
        (queuePhase.restartMs === null
          ? ' (--skip-restart)'
          : ` (redis restart ${Math.round(queuePhase.restartMs)} ms)`),
    );
    if (queuePhase.lost !== 0) {
      failures.push(`queue: ${queuePhase.lost} job(s) lost across the Redis restart`);
    }
    if (queuePhase.completed !== options.jobs || queuePhase.failed !== 0) {
      failures.push(
        `queue: completed ${queuePhase.completed}/${options.jobs} with ${queuePhase.failed} failed`,
      );
    }
  } catch (error) {
    failures.push(`queue phase: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log();
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('load smoke: PASS (NFR-1 webhook ack + pipeline p95, NFR-2 queue durability)');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
