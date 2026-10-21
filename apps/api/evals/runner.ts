import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { asc, eq } from 'drizzle-orm';

import type { AgentAnswer } from '@support-agent/shared';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/db/database.service';
import { users } from '../src/db/schema';
import { AgentService } from '../src/modules/agent/agent.service';
import { KnowledgeBaseService } from '../src/modules/knowledge-base/knowledge-base.service';
import { LlmService } from '../src/modules/llm/llm.service';
import {
  listCorpusDocuments,
  loadDatasets,
  readCorpusDocument,
  type CorpusDocument,
  type EvalCase,
} from './dataset';
import { judgeAnswer } from './judge';
import {
  evaluateGates,
  gateFailures,
  summarize as overallSummary,
  summarizeByTopic,
  EVAL_GATES,
  type CaseOutcome,
  type EvalMetrics,
  type GateResult,
} from './metrics';

/**
 * RAG eval runner (T-108) — `pnpm evals [-- --topic=<slug>] [--keep] [--verbose] [--allow-production]`.
 *
 * Creates a scratch knowledge base (`__eval__ …`), ingests `evals/corpus/`
 * through the real pipeline (upload → queue → worker → chunks), runs every
 * dataset case through `AgentService.ask()`, judges groundedness, prints the
 * metrics table, and exits non-zero when a gate fails
 * (docs/architecture/rag-pipeline.md § Quality).
 *
 * Requires Postgres + Redis (`docker compose up postgres redis`) and at least
 * one seeded user (`pnpm seed:admin`). The scratch KB is deleted afterwards
 * unless `--keep` is passed.
 */

const INGEST_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 250;
const KB_NAME_PREFIX = '__eval__';
const RESULTS_DIR = path.join(__dirname, '.results');

interface Flags {
  topic?: string;
  keep: boolean;
  verbose: boolean;
  allowProduction: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { keep: false, verbose: false, allowProduction: false };
  for (const arg of argv) {
    if (arg === '--') {
      // pnpm forwards the separator itself in some versions.
      continue;
    } else if (arg === '--keep') {
      flags.keep = true;
    } else if (arg === '--verbose') {
      flags.verbose = true;
    } else if (arg === '--allow-production') {
      flags.allowProduction = true;
    } else if (arg.startsWith('--topic=')) {
      flags.topic = arg.slice('--topic='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'usage: pnpm evals [-- --topic=<slug>] [--keep] [--verbose] [--allow-production]\n' +
          '  --topic=<slug>       only run one dataset topic\n' +
          '  --keep               keep the scratch knowledge base for inspection\n' +
          '  --verbose            print every case, not just failures\n' +
          '  --allow-production   permit a run when NODE_ENV=production (writes real rows)',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument "${arg}" (try --help)`);
    }
  }
  return flags;
}

interface RunContext {
  agent: AgentService;
  llm: LlmService;
  kbId: string;
  verbose: boolean;
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2));
  if (process.env.NODE_ENV === 'production' && !flags.allowProduction) {
    throw new Error(
      'refusing to run evals with NODE_ENV=production (pass --allow-production to override)',
    );
  }
  const startedAt = new Date().toISOString();

  const datasets = await loadDatasets();
  const selected = flags.topic ? datasets.filter((set) => set.topic === flags.topic) : datasets;
  if (selected.length === 0) {
    throw new Error(
      `unknown topic "${flags.topic}" — available: ${datasets.map((set) => set.topic).join(', ')}`,
    );
  }
  const cases = selected.flatMap((set) => set.cases);
  const corpus = await listCorpusDocuments();

  console.log(
    `RAG evals — ${cases.length} case(s), ${selected.length} topic(s), ${corpus.length} corpus document(s)\n`,
  );

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const knowledgeBase = app.get(KnowledgeBaseService);
    const agent = app.get(AgentService);
    const llm = app.get(LlmService);
    const database = app.get(DatabaseService);
    const config = app.get(ConfigService);
    const provider = config.get<string>('LLM_PROVIDER') ?? 'mock';

    const userId = await pickUserId(database);
    const kbName = `${KB_NAME_PREFIX} ${startedAt}`;
    const kb = await knowledgeBase.create(
      {
        name: kbName,
        description: 'Temporary knowledge base created by `pnpm evals` — safe to delete.',
      },
      userId,
    );
    console.log(`scratch knowledge base: ${kb.id} ("${kbName}")\n`);

    try {
      await ingestCorpus(knowledgeBase, kb.id, corpus, userId);
      const outcomes = await runCases({ agent, llm, kbId: kb.id, verbose: flags.verbose }, cases);
      const overall = overallSummary(outcomes);
      const byTopic = summarizeByTopic(outcomes);
      const gates = evaluateGates(overall);

      printReport(provider, byTopic, overall, gates);

      const results = {
        startedAt,
        finishedAt: new Date().toISOString(),
        provider,
        thresholds: EVAL_GATES,
        overall,
        perTopic: Object.fromEntries(byTopic),
        gates: gates.map((gate) => ({
          name: gate.name,
          target: gate.target,
          ok: gate.ok,
          rate: gate.metric.rate,
        })),
        cases: outcomes,
      };
      await mkdir(RESULTS_DIR, { recursive: true });
      const stamp = startedAt.replace(/[:.]/g, '-');
      const runPath = path.join(RESULTS_DIR, `${stamp}.json`);
      const latestPath = path.join(RESULTS_DIR, 'latest.json');
      const previous = await readPrevious(latestPath);
      await writeFile(runPath, `${JSON.stringify(results, null, 2)}\n`);
      await writeFile(latestPath, `${JSON.stringify(results, null, 2)}\n`);
      printDeltas(previous, overall);
      console.log(`\nresults: ${path.relative(process.cwd(), runPath)}`);

      const failures = gateFailures(gates);
      if (failures.length > 0) {
        console.log(`\nGATE FAILED — ${failures.join('; ')}`);
        return 1;
      }
      console.log('\ngate: PASS');
      return 0;
    } finally {
      if (flags.keep) {
        console.log(`keeping scratch KB ${kb.id} (--keep)`);
      } else {
        await knowledgeBase.remove(kb.id, userId);
        console.log(`removed scratch KB ${kb.id}`);
      }
    }
  } finally {
    await app.close();
  }
}

/** First active user — any role can own the scratch KB. */
async function pickUserId(database: DatabaseService): Promise<string> {
  const [row] = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!row) {
    throw new Error('no active user found — run `pnpm seed:admin` first');
  }
  return row.id;
}

async function ingestCorpus(
  knowledgeBase: KnowledgeBaseService,
  kbId: string,
  corpus: CorpusDocument[],
  userId: string,
): Promise<void> {
  console.log(`ingesting ${corpus.length} corpus document(s) through the live pipeline…`);
  for (const document of corpus) {
    const buffer = await readCorpusDocument(document);
    const { documentId } = await knowledgeBase.uploadDocument(
      kbId,
      {
        originalname: document.filename,
        mimetype: 'text/markdown',
        size: buffer.length,
        buffer,
      },
      userId,
    );
    console.log(`  queued ${document.filename} (${documentId})`);
  }

  const deadline = Date.now() + INGEST_TIMEOUT_MS;
  for (;;) {
    const documents = await knowledgeBase.listDocuments(kbId);
    const failed = documents.filter((item) => item.status === 'failed');
    if (failed.length > 0) {
      throw new Error(
        `ingestion failed: ${failed
          .map((item) => `${item.filename}: ${item.error ?? 'unknown error'}`)
          .join('; ')}`,
      );
    }
    if (documents.length === corpus.length && documents.every((item) => item.status === 'ready')) {
      const chunks = documents.reduce((sum, item) => sum + item.chunkCount, 0);
      console.log(`  all ${documents.length} document(s) ready — ${chunks} chunk(s)\n`);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`ingestion did not finish within ${INGEST_TIMEOUT_MS / 1000}s`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function runCases(context: RunContext, cases: EvalCase[]): Promise<CaseOutcome[]> {
  console.log(`running ${cases.length} case(s)…`);
  const outcomes: CaseOutcome[] = [];
  for (const testCase of cases) {
    const outcome = await runCase(context, testCase);
    outcomes.push(outcome);
    if (outcome.error) {
      console.log(`  ✗ ${testCase.id} — error: ${outcome.error}`);
    } else if (!outcomePassed(outcome)) {
      console.log(`  ✗ ${testCase.id} — ${describeFailure(outcome, testCase)}`);
    } else if (context.verbose) {
      console.log(`  ✓ ${testCase.id}${scoreNote(outcome)}`);
    }
  }
  console.log('');
  return outcomes;
}

async function runCase(context: RunContext, testCase: EvalCase): Promise<CaseOutcome> {
  const base: CaseOutcome = {
    id: testCase.id,
    topic: testCase.topic,
    type: testCase.type,
    escalated: false,
    escalationReason: null,
    hit: null,
    escalationOk: null,
    grounded: null,
    forbiddenHits: [],
    bestScore: null,
    answerPreview: '',
    error: null,
  };

  try {
    const answer = await context.agent.ask({
      question: testCase.question,
      kbIds: [context.kbId],
      history: testCase.history ?? [],
    });

    let grounded: boolean | null = null;
    if (testCase.type === 'answer' && !answer.escalated) {
      const judgment = await judgeAnswer(context.llm, {
        question: testCase.question,
        answer: answer.answer,
        chunks: answer.chunks,
      });
      grounded = judgment.verdict.verdict === 'grounded';
    }

    return {
      ...base,
      escalated: answer.escalated,
      escalationReason: answer.escalationReason,
      hit: testCase.type === 'answer' ? expectedDocumentHit(answer, testCase) : null,
      escalationOk:
        testCase.type === 'answer'
          ? !answer.escalated
          : testCase.type === 'escalate'
            ? answer.escalated
            : null,
      grounded,
      forbiddenHits: findForbidden(answer.answer, testCase.forbiddenPhrases ?? []),
      bestScore: answer.chunks[0]?.score ?? null,
      answerPreview: answer.answer.replace(/\s+/g, ' ').slice(0, 160),
    };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function expectedDocumentHit(answer: AgentAnswer, testCase: EvalCase): boolean {
  const expected = new Set(testCase.expectedDocuments ?? []);
  return answer.chunks.some((chunk) => expected.has(chunk.document));
}

function findForbidden(answer: string, phrases: string[]): string[] {
  const haystack = answer.toLowerCase();
  return phrases.filter((phrase) => haystack.includes(phrase.toLowerCase()));
}

function outcomePassed(outcome: CaseOutcome): boolean {
  return (
    outcome.hit !== false &&
    outcome.escalationOk !== false &&
    outcome.grounded !== false &&
    outcome.forbiddenHits.length === 0
  );
}

function describeFailure(outcome: CaseOutcome, testCase: EvalCase): string {
  const parts: string[] = [];
  if (outcome.escalationOk === false) {
    parts.push(
      outcome.escalated
        ? `escalated (${outcome.escalationReason ?? 'unknown'}) but should have been answered`
        : 'not escalated but should have been',
    );
  }
  if (outcome.hit === false) {
    parts.push(`expected ${testCase.expectedDocuments?.join(', ')} missing from chunks`);
  }
  if (outcome.grounded === false) {
    parts.push('judge: unsupported claims');
  }
  if (outcome.forbiddenHits.length > 0) {
    parts.push(`reply leaked: ${outcome.forbiddenHits.join(', ')}`);
  }
  return parts.join('; ') || 'failed';
}

function scoreNote(outcome: CaseOutcome): string {
  return outcome.bestScore === null ? '' : ` (score ${outcome.bestScore.toFixed(2)})`;
}

function printReport(
  provider: string,
  byTopic: Map<string, EvalMetrics>,
  overall: EvalMetrics,
  gates: GateResult[],
): void {
  if (provider === 'mock') {
    console.log(
      'provider: mock — groundedness uses the mock judge (plumbing check); ' +
        'run with LLM_PROVIDER=openai|openrouter|gemini|vertex for a real number\n',
    );
  } else {
    console.log(`provider: ${provider}\n`);
  }

  const format = (metric: EvalMetrics['retrievalHit']): string =>
    metric.rate === null ? '—' : `${metric.rate.toFixed(2)} (${metric.passed}/${metric.total})`;
  const header = ['topic', 'cases', 'hit rate', 'escalation', 'groundedness', 'injection'];
  const widths = [22, 6, 16, 16, 16, 16];
  const row = (cells: string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 12))
      .join(' ')
      .trimEnd();

  console.log(row(header));
  for (const [topic, metrics] of byTopic) {
    console.log(
      row([
        topic,
        String(metrics.cases),
        format(metrics.retrievalHit),
        format(metrics.escalation),
        format(metrics.groundedness),
        format(metrics.injection),
      ]),
    );
  }
  console.log(
    row([
      'overall',
      String(overall.cases),
      format(overall.retrievalHit),
      format(overall.escalation),
      format(overall.groundedness),
      format(overall.injection),
    ]),
  );

  console.log('\ngates:');
  for (const gate of gates) {
    const mark = gate.ok === null ? '·' : gate.ok ? '✓' : '✗';
    const value =
      gate.metric.rate === null
        ? '—'
        : `${gate.metric.rate.toFixed(2)} (${gate.metric.passed}/${gate.metric.total})`;
    console.log(`  ${mark} ${gate.name} ${gate.target} — ${value}`);
  }

  const detail: Array<[string, string[]]> = [
    ['false escalations', overall.falseEscalations],
    ['missed escalations', overall.missedEscalations],
    ['injection violations', overall.injectionViolations],
    ['case errors', overall.errored],
  ];
  for (const [label, ids] of detail) {
    if (ids.length > 0) {
      console.log(`  ${label}: ${ids.join(', ')}`);
    }
  }
}

async function readPrevious(latestPath: string): Promise<{ overall: EvalMetrics } | null> {
  try {
    const parsed = JSON.parse(await readFile(latestPath, 'utf8')) as { overall?: EvalMetrics };
    return parsed.overall ? { overall: parsed.overall } : null;
  } catch {
    return null;
  }
}

function printDeltas(previous: { overall: EvalMetrics } | null, current: EvalMetrics): void {
  if (!previous) {
    return;
  }
  const pairs: Array<[string, number | null, number | null]> = [
    ['hit rate', previous.overall.retrievalHit.rate, current.retrievalHit.rate],
    ['escalation', previous.overall.escalation.rate, current.escalation.rate],
    ['groundedness', previous.overall.groundedness.rate, current.groundedness.rate],
    ['injection', previous.overall.injection.rate, current.injection.rate],
  ];
  const deltas = pairs
    .filter(([, before, after]) => before !== null && after !== null)
    .map(([label, before, after]) => {
      const delta = (after ?? 0) - (before ?? 0);
      const sign = delta > 0 ? '+' : '';
      return `${label} ${sign}${delta.toFixed(2)}`;
    });
  if (deltas.length > 0) {
    console.log(`\nvs previous run: ${deltas.join(', ')}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main()
  .then((code) => {
    // Nest keeps BullMQ/Redis handles open; a CLI run must exit explicitly.
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(`\nevals failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
