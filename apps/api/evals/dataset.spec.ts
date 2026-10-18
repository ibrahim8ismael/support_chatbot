import { describe, expect, it } from 'vitest';

import { listCorpusDocuments, loadDatasets } from './dataset';
import { checkCase, chunkCorpus, scoreCase } from './retrieval-check';

describe('eval dataset', () => {
  it('loads, validates, and stays within the 50–100 case target', async () => {
    const datasets = await loadDatasets();
    const cases = datasets.flatMap((dataset) => dataset.cases);

    expect(datasets.length).toBeGreaterThanOrEqual(3);
    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(cases.length).toBeLessThanOrEqual(100);

    for (const dataset of datasets) {
      const types = new Set(dataset.cases.map((testCase) => testCase.type));
      expect(types, `${dataset.topic} needs all three case types`).toContain('answer');
      expect(types).toContain('escalate');
      expect(types).toContain('injection');
    }
  });

  it('points every expectation at a corpus document of the same topic', async () => {
    const [datasets, corpus] = await Promise.all([loadDatasets(), listCorpusDocuments()]);
    const corpusByTopic = new Map<string, Set<string>>();
    for (const document of corpus) {
      const files = corpusByTopic.get(document.topic) ?? new Set<string>();
      files.add(document.filename);
      corpusByTopic.set(document.topic, files);
    }

    for (const dataset of datasets) {
      const corpusFiles = corpusByTopic.get(dataset.topic);
      expect(corpusFiles, `${dataset.topic} needs a corpus directory`).toBeDefined();
      for (const testCase of dataset.cases) {
        for (const document of testCase.expectedDocuments ?? []) {
          expect(corpusFiles, `${testCase.id} expects "${document}"`).toContain(document);
        }
      }
    }
  });

  /**
   * The mock is the default provider for dev, CI, and evals, so the dataset
   * must stay within what its lexical embeddings can retrieve — otherwise
   * `pnpm evals` fails for the wrong reason. Authoring is done against this:
   * `tsx evals/mock-scores.ts` prints the full score table.
   */
  it('retrieves every answer case and ignores every escalate case under the mock embeddings', async () => {
    const [datasets, chunksByDocument] = await Promise.all([loadDatasets(), chunkCorpus()]);
    const checks = datasets
      .flatMap((dataset) => dataset.cases)
      .map((testCase) => checkCase(scoreCase(testCase, chunksByDocument)))
      .filter((check) => check.type !== 'injection');

    const failures = checks.filter((check) => !check.ok);
    expect(
      failures.map((check) => `${check.caseId}: ${check.note}`).join('\n'),
      'cases drifted out of the mock-embedding invariants — see tsx evals/mock-scores.ts',
    ).toBe('');
  });
});
