import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

/**
 * Eval set contract (T-108): `evals/dataset/<topic>.json` case files and the
 * `evals/corpus/<topic>/*.md` documents they are graded against. The loader is
 * the single source of truth for both the runner and the dataset tests.
 */

export const EVALS_DIR = path.join(process.cwd(), 'evals');
export const DATASET_DIR = path.join(EVALS_DIR, 'dataset');
export const CORPUS_DIR = path.join(EVALS_DIR, 'corpus');

export const EVAL_CASE_TYPES = ['answer', 'escalate', 'injection'] as const;
export type EvalCaseType = (typeof EVAL_CASE_TYPES)[number];

const HISTORY_TURN = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2_000),
});

const evalCaseSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/, 'ids are kebab-case'),
    type: z.enum(EVAL_CASE_TYPES),
    question: z.string().trim().min(3).max(500),
    history: z.array(HISTORY_TURN).min(1).max(10).optional(),
    /** `answer` cases: the document that must ground the reply (hit rate). */
    expectedDocuments: z.array(z.string().trim().min(1)).min(1).optional(),
    /** `injection` cases: output that must never appear in the final reply. */
    forbiddenPhrases: z.array(z.string().trim().min(2)).min(1).optional(),
  })
  .superRefine((testCase, ctx) => {
    if (testCase.type === 'answer' && !testCase.expectedDocuments) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedDocuments'],
        message: 'answer cases need expectedDocuments',
      });
    }
    if (testCase.type !== 'answer' && testCase.expectedDocuments) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedDocuments'],
        message: 'only answer cases carry expectedDocuments',
      });
    }
    if (testCase.type === 'injection' && !testCase.forbiddenPhrases) {
      ctx.addIssue({
        code: 'custom',
        path: ['forbiddenPhrases'],
        message: 'injection cases need forbiddenPhrases',
      });
    }
    if (testCase.type !== 'injection' && testCase.forbiddenPhrases) {
      ctx.addIssue({
        code: 'custom',
        path: ['forbiddenPhrases'],
        message: 'only injection cases carry forbiddenPhrases',
      });
    }
  });

const datasetFileSchema = z.strictObject({
  topic: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'topics are kebab-case'),
  cases: z.array(evalCaseSchema).min(1),
});

export type EvalCase = z.infer<typeof evalCaseSchema> & { topic: string };

export interface EvalDataset {
  topic: string;
  file: string;
  cases: EvalCase[];
}

export interface CorpusDocument {
  topic: string;
  filename: string;
  path: string;
}

/** Reads every dataset file, validating shape, topic↔filename, and unique ids. */
export async function loadDatasets(): Promise<EvalDataset[]> {
  const files = (await readdir(DATASET_DIR)).filter((name) => name.endsWith('.json')).sort();
  const datasets: EvalDataset[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const raw: unknown = JSON.parse(await readFile(path.join(DATASET_DIR, file), 'utf8'));
    const parsed = datasetFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`evals/dataset/${file} is invalid:\n${z.prettifyError(parsed.error)}`);
    }

    const expectedTopic = file.replace(/\.json$/, '');
    if (parsed.data.topic !== expectedTopic) {
      throw new Error(
        `evals/dataset/${file}: topic "${parsed.data.topic}" must match the file name "${expectedTopic}"`,
      );
    }

    for (const testCase of parsed.data.cases) {
      const previous = seen.get(testCase.id);
      if (previous) {
        throw new Error(`duplicate eval case id "${testCase.id}" (${previous} and ${file})`);
      }
      seen.set(testCase.id, file);
    }

    datasets.push({
      topic: parsed.data.topic,
      file,
      cases: parsed.data.cases.map((testCase) => ({ ...testCase, topic: parsed.data.topic })),
    });
  }

  if (datasets.length === 0) {
    throw new Error('no dataset files found in evals/dataset');
  }
  return datasets;
}

/** All corpus documents (one topic directory per dataset topic). */
export async function listCorpusDocuments(): Promise<CorpusDocument[]> {
  const entries = await readdir(CORPUS_DIR, { withFileTypes: true });
  const documents: CorpusDocument[] = [];

  for (const entry of entries.filter((item) => item.isDirectory()).sort(byName)) {
    const topicDir = path.join(CORPUS_DIR, entry.name);
    for (const filename of (await readdir(topicDir))
      .filter((name) => name.endsWith('.md'))
      .sort()) {
      documents.push({ topic: entry.name, filename, path: path.join(topicDir, filename) });
    }
  }
  return documents;
}

export async function readCorpusDocument(document: CorpusDocument): Promise<Buffer> {
  return readFile(document.path);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
