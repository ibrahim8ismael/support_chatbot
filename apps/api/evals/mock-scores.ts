import { checkCase, chunkCorpus, scoreCase } from './retrieval-check';
import { loadDatasets } from './dataset';

/**
 * Prints the mock-embedding score table for every eval case:
 *
 *   pnpm --filter api exec tsx evals/mock-scores.ts [--topic=<slug>]
 *
 * Use it while authoring questions or corpus docs — it needs no database and
 * no Redis. Exit code 1 means a case drifted out of the invariants that
 * `dataset.spec.ts` enforces in CI.
 */

async function main(): Promise<number> {
  const topicFlag = process.argv.slice(2).find((arg) => arg.startsWith('--topic='));
  const topicFilter = topicFlag?.slice('--topic='.length);

  const [datasets, chunksByDocument] = await Promise.all([loadDatasets(), chunkCorpus()]);
  const cases = datasets
    .flatMap((dataset) => dataset.cases)
    .filter((testCase) => !topicFilter || testCase.topic === topicFilter);

  console.log(
    `mock embeddings — ${cases.length} case(s) vs ${chunksByDocument.size} corpus document(s)\n`,
  );

  let failures = 0;
  let topic = '';
  for (const testCase of cases) {
    if (testCase.topic !== topic) {
      topic = testCase.topic;
      console.log(`${topic}`);
    }
    const check = checkCase(scoreCase(testCase, chunksByDocument));
    if (!check.ok) {
      failures += 1;
    }
    console.log(
      `  ${check.ok ? '✓' : '✗'} [${testCase.type}] ${check.caseId}\n      ${check.note}`,
    );
  }

  console.log(
    `\n${failures === 0 ? 'all cases within invariants' : `${failures} case(s) out of bounds`}`,
  );
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
