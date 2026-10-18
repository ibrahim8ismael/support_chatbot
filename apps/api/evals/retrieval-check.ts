import { buildRetrievalQuery } from '../src/modules/agent/prompt';
import { cleanBlocks } from '../src/modules/ingestion/cleaning';
import { chunkBlocks } from '../src/modules/ingestion/chunking';
import { parseDocument } from '../src/modules/ingestion/parsers';
import { mockEmbedText } from '../src/modules/llm/providers/mock.provider';
import type { ChatTurn } from '../src/modules/llm/llm.types';
import { listCorpusDocuments, readCorpusDocument, type EvalCase } from './dataset';

/**
 * Offline retrieval check for the mock embeddings. The mock embeds with a
 * bag-of-words feature hash, so "would this question retrieve its document?"
 * is a pure function of the text — no Postgres, no Redis, no provider keys.
 *
 * The mock is the default everywhere (dev, CI, evals), so this module is the
 * guard that keeps the dataset and the corpus coherent: `dataset.spec.ts`
 * asserts the invariants below, and `mock-scores.ts` prints the full table for
 * when you are authoring questions. Real embeddings are more forgiving of
 * paraphrase — re-run `pnpm evals` with a real provider before launch.
 */

/** `settings.retrieval_score_threshold` default the live pipeline applies. */
export const MOCK_RETRIEVAL_FLOOR = 0.35;
/** Escalate cases must stay clearly under the threshold, not merely below it. */
export const MOCK_ESCALATION_CEILING = 0.3;
/** `settings.context_chunks` default — the top-N window the hit rate checks. */
export const MOCK_TOP_CHUNKS = 5;

export interface DocumentScore {
  filename: string;
  score: number;
}

export interface CaseScore {
  testCase: EvalCase;
  query: string;
  /** Every corpus document, best chunk first. */
  scores: DocumentScore[];
  best: DocumentScore | null;
  /** Best score over the case's expected documents (answer cases). */
  expectedScore: number | null;
  /** 1-based rank of the best expected document among all documents. */
  expectedRank: number | null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const valueA = a[index] ?? 0;
    const valueB = b[index] ?? 0;
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Parses + chunks every corpus document, keyed by filename. */
export async function chunkCorpus(): Promise<Map<string, string[]>> {
  const chunksByDocument = new Map<string, string[]>();
  for (const document of await listCorpusDocuments()) {
    const buffer = await readCorpusDocument(document);
    const blocks = cleanBlocks(await parseDocument(buffer, 'text/markdown'));
    chunksByDocument.set(
      document.filename,
      chunkBlocks(blocks).map((draft) => draft.content),
    );
  }
  return chunksByDocument;
}

export function scoreCase(testCase: EvalCase, chunksByDocument: Map<string, string[]>): CaseScore {
  const query = buildRetrievalQuery(testCase.question, (testCase.history ?? []) as ChatTurn[]);
  const queryVector = mockEmbedText(query);

  const scores: DocumentScore[] = [...chunksByDocument.entries()]
    .map(([filename, chunks]) => ({
      filename,
      score: Math.max(
        ...chunks.map((chunk) => cosineSimilarity(queryVector, mockEmbedText(chunk))),
      ),
    }))
    .sort((left, right) => right.score - left.score);

  const expected = testCase.expectedDocuments ?? [];
  const expectedScore =
    expected.length === 0
      ? null
      : Math.max(
          ...expected.map((doc) => scores.find((entry) => entry.filename === doc)?.score ?? 0),
        );
  const expectedIndex =
    expected.length === 0 ? -1 : scores.findIndex((entry) => expected.includes(entry.filename));
  const expectedRank = expectedIndex === -1 ? null : expectedIndex + 1;

  return { testCase, query, scores, best: scores[0] ?? null, expectedScore, expectedRank };
}

export interface RetrievalCheck {
  caseId: string;
  topic: string;
  type: EvalCase['type'];
  ok: boolean;
  note: string;
  score: CaseScore;
}

/**
 * The mock-embedding invariants: answer cases must clear the threshold and
 * land inside the top-5; escalate cases must stay under the ceiling.
 * Injection cases are informational (either the guard path or escalation is a
 * pass — see eval README).
 */
export function checkCase(score: CaseScore): RetrievalCheck {
  const { testCase } = score;
  const precision = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : value.toFixed(2);

  if (testCase.type === 'answer') {
    const ok =
      (score.expectedScore ?? 0) >= MOCK_RETRIEVAL_FLOOR &&
      (score.expectedRank ?? Infinity) <= MOCK_TOP_CHUNKS;
    return {
      caseId: testCase.id,
      topic: testCase.topic,
      type: testCase.type,
      ok,
      note: `expected ${testCase.expectedDocuments?.join(', ')} → ${precision(score.expectedScore)} (rank ${score.expectedRank})`,
      score,
    };
  }

  if (testCase.type === 'escalate') {
    const bestScore = score.best?.score ?? 0;
    return {
      caseId: testCase.id,
      topic: testCase.topic,
      type: testCase.type,
      ok: bestScore < MOCK_ESCALATION_CEILING,
      note: `best ${score.best?.filename ?? '—'} → ${precision(bestScore)} (ceiling ${MOCK_ESCALATION_CEILING})`,
      score,
    };
  }

  return {
    caseId: testCase.id,
    topic: testCase.topic,
    type: testCase.type,
    ok: true,
    note: `best ${score.best?.filename ?? '—'} → ${precision(score.best?.score ?? null)} (informational)`,
    score,
  };
}
