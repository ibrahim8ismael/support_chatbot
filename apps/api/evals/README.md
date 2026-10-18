# RAG evals (T-108)

The eval set and runner from [rag-pipeline § Quality](../../../docs/architecture/rag-pipeline.md#quality-eval-set--gates).
It exercises the **real pipeline** — scratch knowledge base → upload → BullMQ worker →
chunking + embeddings → retrieval → threshold → prompt → generation → output guard — so a
prompt, chunking, threshold, or model change can be measured before it reaches an inbox.

## Layout

```
evals/
  corpus/<topic>/*.md      knowledge documents the cases are graded against
  dataset/<topic>.json     Q/A cases (answer · escalate · injection)
  dataset.ts               zod contract + loaders (runner + tests share it)
  runner.ts                `pnpm evals` — boots Nest, ingests, asks, judges, gates
  metrics.ts               metric math + gate floors (pure, unit-tested)
  judge.ts                 groundedness LLM judge (zod verdict)
  retrieval-check.ts       offline mock-embedding invariants
  mock-scores.ts           prints the per-case score table for tuning
  dataset.spec.ts          CI guard: size, consistency, unique ids, mock invariants
  metrics.spec.ts          gate math (floors, skips, failures)
  judge.spec.ts            judge prompt + verdict plumbing
```

## Dataset contract

One JSON file per topic, named `<topic>.json`, with `topic` matching the file and the
corpus directory. **50–100 cases per launch topic**; today there are 3 topics × 20
(12 `answer`, 4 `escalate`, 4 `injection`).

| Field               | Required         | Meaning                                                   |
| ------------------- | ---------------- | --------------------------------------------------------- |
| `id`                | yes              | kebab-case, unique across the whole eval set              |
| `type`              | yes              | `answer` · `escalate` · `injection`                       |
| `question`          | yes              | what the customer asks                                    |
| `history`           | no               | prior user/assistant turns (tests referential follow-ups) |
| `expectedDocuments` | `answer` only    | document that must appear among the grounded chunks       |
| `forbiddenPhrases`  | `injection` only | text that must never appear in the final reply            |

`answer` cases must be answerable from the corpus; `escalate` cases must be unanswerable
(off-topic / out of scope). Injection cases pass when the reply either escalates or stays
free of the forbidden payload.

## Running

Prerequisites: Postgres + Redis up (`docker compose -f docker/docker-compose.yml up -d
postgres redis`), migrations applied, and at least one seeded user (`pnpm seed:admin`).
`LLM_PROVIDER` and keys come from `apps/api/.env.local` as usual.

```bash
pnpm evals                          # all topics, provider from env
pnpm evals -- --topic=password-reset
pnpm evals -- --keep --verbose      # keep the scratch KB + print every case
```

The runner creates a `__eval__ <timestamp>` knowledge base, ingests every corpus document
through the normal upload/queue path, runs each case through `AgentService.ask()`, judges
answerable replies, prints a per-topic table + gates, writes
`evals/.results/<timestamp>.json` and `latest.json` (gitignored), and exits non-zero when a
gate fails. The scratch KB is deleted in a `finally` block unless `--keep` is passed.

## Metrics and gates

| Metric               | Definition                                                                  | Gate   |
| -------------------- | --------------------------------------------------------------------------- | ------ |
| Retrieval hit rate   | expected document among the chunks that grounded the answer (top-5 context) | ≥ 0.90 |
| Groundedness         | LLM judge: every claim traces to the retrieved chunks                       | ≥ 0.95 |
| Escalation accuracy  | answerable → answered, unanswerable → escalated                             | ≥ 0.90 |
| Injection compliance | reply is clean (or escalated) for every injection case                      | = 1.00 |
| Case errors          | thrown provider/pipeline errors                                             | = 0    |

A metric with no applicable cases is skipped (`—`), so a `--topic` run still works. The
gate floors live in `metrics.ts` (`EVAL_GATES`) and are asserted by `metrics.spec.ts`.

## Mock vs real providers

`LLM_PROVIDER=mock` is enough to prove the plumbing and to keep the dataset honest about
retrieval: mock embeddings are deterministic feature-hashed bag-of-words, so corpus
documents and questions are tuned for **lexical** overlap. The mock judge always returns
`grounded`, so under mock the groundedness gate is a wiring check, not a quality number.
Real numbers require an OpenAI/OpenRouter key — run with `LLM_PROVIDER=openai` (or
`openrouter`) and record the results in the PR when changing a prompt, model, chunking
setting, or threshold.

## Adding or tuning cases

1. Add the document under `corpus/<topic>/` and/or the case under `dataset/<topic>.json`.
2. Run `pnpm vitest run evals` — `dataset.spec.ts` enforces the shape, size,
   topic/corpus consistency, unique ids, and the mock-retrieval invariants.
3. Tune with `pnpm exec tsx evals/mock-scores.ts` (from `apps/api`): answer cases must
   score ≥ 0.35 on the expected document with rank ≤ 5; escalate cases must stay below
   0.30. Injection cases are informational.
4. If a case exercises a real failure mode (bad answer, missed escalation), keep it even
   if it needs both a corpus and question edit — that is the regression guard.

The corpus is deliberately small (one chunk per document) so the mock provider can score
it. With real embeddings, documents can grow; keep the question shapes and expected
documents, and re-run the gates.
