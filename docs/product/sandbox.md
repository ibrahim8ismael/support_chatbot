# Sandbox — owner-facing accuracy testing

The Sandbox lets the owner test how well the knowledge bases and the agent answer
real questions without touching Chatwoot, live settings, or customer conversations.

It builds on the existing Playground (the manual answer path) and the `evals/`
CLI (the metric definitions), so there is one answer pipeline and one definition
of quality.

## Why

Today the Playground answers one question at a time and forgets it. The `evals/`
runner can measure quality, but it is a developer CLI with local corpus files.
An owner cannot answer the practical question: **"are our KBs good enough right
now, and what got worse since last week?"**

The Sandbox closes that gap with saved test cases and scored, asynchronous runs.

## Workflow

1. **Try it** — ask a question against selected KBs. Inspect the answer, sources,
   scores, escalation reason, latency, and tokens.
2. **Save as a test case** — the question becomes ground truth: expected behavior,
   expected source documents, required/forbidden phrases, tags, notes.
3. **Run** — pick cases and KBs, start a background run, follow progress.
4. **Review** — see pass/fail per case with a reason, open the source chunks, and
   mark the answer correct/incorrect yourself.
5. **Improve** — fix the KB or prompt, rerun, and compare.

## Accuracy model

The MVP deliberately uses deterministic checks plus human review. An LLM judge
is a Phase 3 addition because it costs money and must not be presented as truth.

| Check | Cost | Pass condition |
| --- | --- | --- |
| Expected behavior | Free | Answer/escalate matches the case |
| Retrieval hit | Free | An expected source filename is among the grounded chunks |
| Required phrases | Free | Every required phrase appears (case-insensitive) |
| Forbidden phrases | Free | No forbidden phrase appears |
| Owner review | Human time | Owner marks the result correct/incorrect |

The run reports **auto pass rate** and **owner-verified accuracy** separately.
A case is automatically passed only when every configured check passes and the
pipeline produced no error.

## Screens

### Try it

The existing Playground, embedded as the first Sandbox tab:

- KB selection with document counts.
- Answer card with the escalation reason, grounded chunks, scores, model, prompt
  version, latency, and tokens.
- **Save as test case** on every exchange.
- Empty state links to KB creation.

### Test cases

- List, search, enable/disable, duplicate, delete.
- Create/edit form:
  - question
  - KBs this case usually runs against
  - expected behavior (`answer`, `escalate`, `either`)
  - expected source filenames
  - required phrases
  - forbidden phrases
  - reference answer (for the human reviewer; not scored in the MVP)
  - tags and notes
- Cases are snapshotted into a run, so editing or deleting a case never rewrites
  history.

### Runs

- Create a run: name, cases (default: all enabled), KBs.
- Guardrail: 100 cases per run, 10 runs per user per day.
- Background BullMQ worker; progress, cancel, retry failed, resume cancelled/failed
  pending cases.
- Result list with verdict, failure reason, answer, sources, best score.
- Result detail: full answer, grounded chunks, checks, and owner review.
- Summary cards: auto pass rate, verified accuracy, retrieval hit rate,
  behavior accuracy, required/forbidden checks, errors.
- Export results as CSV.

## Backend

### Module

`apps/api/src/modules/sandbox/` owns the three tables and the run worker:

- `sandbox.service.ts` — case CRUD, run creation, review, cancel, retry.
- `sandbox.worker.ts` — BullMQ consumer on the `sandbox-run` queue.
- `scoring.ts` — pure checks and metric aggregation.
- `sandbox.controller.ts` — REST endpoints.
- `entities/` — Drizzle tables.

It reuses `AgentService.ask()` exactly as the live pipeline and Playground do.
It does **not** write `answer_events` (those need conversation/message context
and feed production analytics).

### Tables

| Table | Purpose |
| --- | --- |
| `sandbox_cases` | Saved questions and expected outcomes |
| `sandbox_runs` | One batch run: KBs, case ids, settings snapshot, status, metrics |
| `sandbox_results` | Immutable per-case snapshot and outcome |

`settings_snapshot` records the retrieval/generation settings and `prompt_version`
records the answer prompt, so a result is explainable later.

### API

| Method | Path | Access |
| --- | --- | --- |
| GET | `/sandbox/cases` | editor/admin |
| POST | `/sandbox/cases` | editor/admin |
| PATCH | `/sandbox/cases/:id` | editor/admin |
| DELETE | `/sandbox/cases/:id` | admin |
| POST | `/sandbox/runs` | editor/admin |
| GET | `/sandbox/runs` | editor/admin |
| GET | `/sandbox/runs/:id` | editor/admin |
| GET | `/sandbox/runs/:id/results` | editor/admin |
| POST | `/sandbox/runs/:id/cancel` | editor/admin |
| POST | `/sandbox/runs/:id/retry-failed` | editor/admin |
| PATCH | `/sandbox/results/:id/review` | editor/admin |

The manual `/playground/ask` endpoint stays as-is for the Try tab.

### Queue and guardrails

- New queue: `sandbox-run` (one job per run, `jobId = sandbox-run:<runId>`).
- Per-case failures become result rows and do not fail the whole run.
- Cancellation is checked between cases.
- Retrying resets failed cases to `pending` and resumes cancelled/failed pending
  cases; completed cases are never re-run.
- Runs are audited (`sandbox.run.start`, `sandbox.run.cancel`, case changes,
  result reviews).
- No per-case `LlmQuotaService` call: the batch cap is the guardrail.

## Delivery

### Phase 1 — MVP (this change)

- Shared contracts, migration, sandbox module, queue worker.
- Cases CRUD, runs, deterministic scoring, results, owner review, cancel,
  retry failed, CSV export.
- Sandbox UI with Try it / Test cases / Runs.
- Unit tests for scoring, schemas, and the worker.

### Phase 2 — Trust

- Pre-threshold retrieval diagnostics ("closest match was 0.28 vs 0.35").
- Run comparison and deltas.
- Import/export of the `evals/dataset` shape.
- Add cases from real unanswered questions.
- 90-day retention cleanup.

### Phase 3 — Tuning

- Optional groundedness/correctness LLM judge.
- Sandbox-only setting overrides (threshold, topK, context size).
- Compare KB sets for the same cases.
- Accuracy trend dashboard and per-tag/per-KB breakdowns.
