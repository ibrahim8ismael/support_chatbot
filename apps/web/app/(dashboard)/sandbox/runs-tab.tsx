'use client';

import { Alert, Button, Card, Chip, Spinner } from '@heroui/react';
import { CheckCircle2, Download, FlaskConical, Plus, RefreshCw, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

import type { SandboxResult, SandboxRun } from '@support-agent/shared';

import {
  BEHAVIOR_LABELS,
  RUN_STATUS_LABELS,
  failureReasons,
  formatMetric,
  formatRate,
  resultVerdict,
  reviewLabel,
  runStatusColor,
} from '@/lib/sandbox';

export function RunsTab({
  runs,
  selectedRun,
  results,
  resultsLoading,
  onSelect,
  onNew,
  onCancel,
  onRetry,
  onReview,
  onExport,
}: {
  runs: SandboxRun[];
  selectedRun: SandboxRun | null;
  results: SandboxResult[];
  resultsLoading: boolean;
  onSelect: (run: SandboxRun) => void;
  onNew: () => void;
  onCancel: (run: SandboxRun) => void;
  onRetry: (run: SandboxRun) => void;
  onReview: (result: SandboxResult, status: 'pass' | 'fail' | 'unreviewed') => void;
  onExport: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold">Runs</h3>
          <Button size="sm" variant="secondary" onPress={onNew}>
            <Plus className="size-4" aria-hidden />
            New run
          </Button>
        </div>

        {runs.length === 0 ? (
          <Card>
            <Card.Content className="flex flex-col items-center gap-2 py-10 text-center">
              <FlaskConical className="size-7 text-muted" aria-hidden />
              <p className="text-sm font-medium">No runs yet</p>
              <p className="text-xs text-muted">Start a run to see how the KBs score.</p>
            </Card.Content>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((run) => {
              const active = run.id === selectedRun?.id;
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(run)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-accent bg-accent/5 ring-1 ring-accent'
                        : 'border-border bg-surface hover:bg-surface-secondary'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{run.name}</span>
                      <Chip size="sm" variant="soft" color={runStatusColor(run.status)}>
                        {RUN_STATUS_LABELS[run.status]}
                      </Chip>
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {run.completedCount}/{run.caseCount} cases ·{' '}
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="min-w-0">
        {!selectedRun ? (
          <Card className="h-full">
            <Card.Content className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
              <FlaskConical className="size-8 text-muted" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium">Select a run</p>
                <p className="text-xs text-muted">
                  Its accuracy summary and per-case results appear here.
                </p>
              </div>
            </Card.Content>
          </Card>
        ) : (
          <RunDetail
            run={selectedRun}
            results={results}
            loading={resultsLoading}
            onCancel={() => onCancel(selectedRun)}
            onRetry={() => onRetry(selectedRun)}
            onReview={onReview}
            onExport={onExport}
          />
        )}
      </section>
    </div>
  );
}

function RunDetail({
  run,
  results,
  loading,
  onCancel,
  onRetry,
  onReview,
  onExport,
}: {
  run: SandboxRun;
  results: SandboxResult[];
  loading: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onReview: (result: SandboxResult, status: 'pass' | 'fail' | 'unreviewed') => void;
  onExport: () => void;
}) {
  const running = run.status === 'queued' || run.status === 'running';
  const progress = run.caseCount === 0 ? 0 : Math.round((run.completedCount / run.caseCount) * 100);
  const errorCount = results.filter((result) => result.status === 'error').length;
  const pendingCount = results.filter((result) => result.status === 'pending').length;
  const canRetry = !running && (errorCount > 0 || pendingCount > 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold">{run.name}</h3>
                <Chip size="sm" variant="soft" color={runStatusColor(run.status)}>
                  {RUN_STATUS_LABELS[run.status]}
                </Chip>
              </div>
              <p className="mt-1 text-xs text-muted">
                {run.completedCount}/{run.caseCount} cases · {run.provider} · {run.promptVersion} ·{' '}
                {new Date(run.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {running ? (
                <Button size="sm" variant="danger" onPress={onCancel}>
                  <XCircle className="size-4" aria-hidden />
                  Cancel
                </Button>
              ) : null}
              {canRetry ? (
                <Button size="sm" variant="secondary" onPress={onRetry}>
                  <RefreshCw className="size-4" aria-hidden />
                  {errorCount > 0 ? `Retry ${errorCount} failed` : 'Resume'}
                </Button>
              ) : null}
              {results.length > 0 ? (
                <Button size="sm" variant="secondary" onPress={onExport}>
                  <Download className="size-4" aria-hidden />
                  Export CSV
                </Button>
              ) : null}
            </div>
          </div>

          {running ? (
            <div className="flex flex-col gap-1">
              <div
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 overflow-hidden rounded-full bg-surface-secondary"
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-muted">
                Running… {run.completedCount}/{run.caseCount} cases done. You can leave this page.
              </p>
            </div>
          ) : null}

          {run.error ? (
            <Alert status="danger" role="alert">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{run.error}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          {run.metrics ? <RunMetrics run={run} /> : null}
        </Card.Content>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : results.length === 0 ? (
        <Card>
          <Card.Content className="py-10 text-center text-sm text-muted">
            No results yet.
          </Card.Content>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {results.map((result) => (
            <li key={result.id}>
              <ResultCard result={result} onReview={onReview} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunMetrics({ run }: { run: SandboxRun }): ReactNode {
  if (!run.metrics) {
    return null;
  }
  const metrics = run.metrics;
  const cards: Array<{ label: string; value: string; hint: string }> = [
    {
      label: 'Auto pass',
      value: formatRate(metrics.autoPass.rate),
      hint: formatMetric(metrics.autoPass),
    },
    {
      label: 'Owner verified',
      value: formatRate(metrics.verified.rate),
      hint:
        metrics.verified.total === 0
          ? 'no reviews yet'
          : `${metrics.verified.passed}/${metrics.verified.total} reviewed`,
    },
    {
      label: 'Retrieval hit',
      value: formatRate(metrics.retrievalHit.rate),
      hint: formatMetric(metrics.retrievalHit),
    },
    {
      label: 'Behavior',
      value: formatRate(metrics.behavior.rate),
      hint: formatMetric(metrics.behavior),
    },
    {
      label: 'Required phrases',
      value: formatRate(metrics.requiredPhrases.rate),
      hint: formatMetric(metrics.requiredPhrases),
    },
    {
      label: 'Forbidden phrases',
      value: formatRate(metrics.forbiddenPhrases.rate),
      hint: formatMetric(metrics.forbiddenPhrases),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-border bg-background/60 p-3">
          <p className="text-xs font-medium text-muted">{card.label}</p>
          <p className="mt-0.5 text-xl font-semibold tracking-tight">{card.value}</p>
          <p className="text-xs text-muted">{card.hint}</p>
        </div>
      ))}
      {metrics.errored.length > 0 ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-3">
          <p className="text-xs font-medium text-danger">Errors</p>
          <p className="mt-0.5 text-sm">{metrics.errored.join(', ')}</p>
        </div>
      ) : null}
    </div>
  );
}

function ResultCard({
  result,
  onReview,
}: {
  result: SandboxResult;
  onReview: (result: SandboxResult, status: 'pass' | 'fail' | 'unreviewed') => void;
}) {
  const verdict = resultVerdict(result);
  const reasons = failureReasons(result);

  return (
    <Card>
      <Card.Content className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{result.caseName}</p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted">{result.question}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft" color={verdict.color}>
              {verdict.label}
            </Chip>
            <Chip
              size="sm"
              variant="soft"
              color={
                result.reviewStatus === 'pass'
                  ? 'success'
                  : result.reviewStatus === 'fail'
                    ? 'danger'
                    : 'default'
              }
            >
              {reviewLabel(result)}
            </Chip>
          </div>
        </div>

        {reasons.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-danger">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        {result.status === 'completed' ? (
          <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-foreground/80">
            {result.answer}
          </p>
        ) : null}

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{result.escalated ? 'Escalated' : 'Answered'}</span>
          {result.bestScore !== null ? (
            <>
              <span aria-hidden>·</span>
              <span>best score {result.bestScore.toFixed(3)}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>{result.latency.totalMs} ms</span>
          <span aria-hidden>·</span>
          <span>
            {result.tokens.input} in / {result.tokens.output} out
          </span>
        </p>

        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-accent">
            Show sources and checks
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>Expected: {BEHAVIOR_LABELS[result.expectedBehavior]}</span>
              {result.expectedFilenames.length > 0 ? (
                <span>Source: {result.expectedFilenames.join(', ')}</span>
              ) : null}
              {result.requiredPhrases.length > 0 ? (
                <span>Required: {result.requiredPhrases.join(', ')}</span>
              ) : null}
              {result.forbiddenPhrases.length > 0 ? (
                <span>Forbidden: {result.forbiddenPhrases.join(', ')}</span>
              ) : null}
            </div>

            {result.referenceAnswer ? (
              <div className="rounded-xl border border-border bg-background/60 p-3">
                <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Reference answer
                </p>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap text-foreground/80">
                  {result.referenceAnswer}
                </p>
              </div>
            ) : null}

            {result.chunks.length > 0 ? (
              <div>
                <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Grounded chunks
                </p>
                <ul className="flex flex-col gap-2">
                  {result.chunks.map((chunk) => (
                    <li
                      key={chunk.id}
                      className="rounded-xl border border-border bg-background/60 p-3"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">{chunk.document}</span>
                        <Chip size="sm" variant="soft">
                          {chunk.score.toFixed(3)}
                        </Chip>
                      </div>
                      <p className="mt-2 text-sm break-words whitespace-pre-wrap text-foreground/80">
                        {chunk.content}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>

        {result.status !== 'pending' ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant={result.reviewStatus === 'pass' ? 'secondary' : 'ghost'}
              onPress={() =>
                onReview(result, result.reviewStatus === 'pass' ? 'unreviewed' : 'pass')
              }
            >
              <CheckCircle2 className="size-3.5" aria-hidden />
              {result.reviewStatus === 'pass' ? 'Correct ✓' : 'Looks correct'}
            </Button>
            <Button
              size="sm"
              variant={result.reviewStatus === 'fail' ? 'danger' : 'secondary'}
              onPress={() =>
                onReview(result, result.reviewStatus === 'fail' ? 'unreviewed' : 'fail')
              }
            >
              <XCircle className="size-3.5" aria-hidden />
              {result.reviewStatus === 'fail' ? 'Incorrect ✗' : 'Wrong answer'}
            </Button>
          </div>
        ) : null}
      </Card.Content>
    </Card>
  );
}
