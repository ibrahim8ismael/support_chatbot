'use client';

import { Alert, Button, Card, ListBox, Select, Table } from '@heroui/react';
import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ANALYTICS_INTERVALS,
  type AnalyticsInterval,
  type AnalyticsOverview,
  type AnalyticsPoint,
  type AnalyticsTimeseries,
  type InboxBinding,
  type UnansweredQuestion,
} from '@support-agent/shared';

import { MetricCard, type MetricTone } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { ApiError, apiFetch } from '@/lib/api';
import {
  ANALYTICS_INTERVAL_LABELS,
  ANALYTICS_RANGES,
  type AnalyticsRangeId,
  bucketLabel,
  buildAnalyticsQuery,
  formatCost,
  formatCount,
  formatLatencyMs,
  formatRate,
  formatTimestamp,
  rangeFor,
} from '@/lib/analytics';
import { formatTokens } from '@/lib/playground';

const UNANSWERED_LIMIT = 10;

/**
 * Analytics dashboard (T-302): aggregates, a dependency-free bar chart and the
 * admin-only unanswered list. Metric definitions: docs/api/rest-api.md.
 */
export function AnalyticsView() {
  const router = useRouter();
  const [rangeId, setRangeId] = useState<AnalyticsRangeId>('7d');
  const [interval, setIntervalValue] = useState<AnalyticsInterval>('day');
  const [inboxId, setInboxId] = useState('');
  const [inboxes, setInboxes] = useState<InboxBinding[]>([]);
  const [inboxFilterRestricted, setInboxFilterRestricted] = useState(false);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<AnalyticsTimeseries | null>(null);
  const [unanswered, setUnanswered] = useState<UnansweredQuestion[]>([]);
  const [unansweredForbidden, setUnansweredForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const handleError = useCallback(
    (cause: unknown): void => {
      if (cause instanceof ApiError && cause.status === 401) {
        router.push('/login');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
    },
    [router],
  );

  // Inbox filter options — bindings are editor/admin; viewers keep "All
  // inboxes" and get a note instead of a silently empty picker (audit P3).
  useEffect(() => {
    let cancelled = false;
    apiFetch<InboxBinding[]>('/bindings')
      .then((rows) => {
        if (!cancelled) {
          setInboxes(rows);
          setInboxFilterRestricted(false);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          router.push('/login');
        } else if (cause instanceof ApiError && cause.status === 403) {
          setInboxFilterRestricted(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filtersRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    // Metrics belong to the active filters: clear them instead of leaving the
    // previous range/inbox numbers under the new controls.
    const key = `${rangeId}|${interval}|${inboxId}`;
    if (filtersRef.current !== '' && filtersRef.current !== key) {
      setOverview(null);
      setTimeseries(null);
      setUnanswered([]);
    }
    filtersRef.current = key;

    setLoading(true);
    setError(null);

    const { from, to } = rangeFor(rangeId);
    const scope = inboxId === '' ? {} : { inboxId: Number(inboxId) };
    const overviewQuery = buildAnalyticsQuery({ from, to, ...scope });
    const timeseriesQuery = buildAnalyticsQuery({ from, to, ...scope, interval });
    const unansweredQuery = buildAnalyticsQuery({ from, to, ...scope, limit: UNANSWERED_LIMIT });
    if (!overviewQuery.ok || !timeseriesQuery.ok || !unansweredQuery.ok) {
      setError('Invalid filters');
      setLoading(false);
      return;
    }

    void (async () => {
      const [overviewResult, timeseriesResult, unansweredResult] = await Promise.allSettled([
        apiFetch<AnalyticsOverview>(`/analytics/overview?${overviewQuery.query}`),
        apiFetch<AnalyticsTimeseries>(`/analytics/timeseries?${timeseriesQuery.query}`),
        apiFetch<UnansweredQuestion[]>(`/analytics/unanswered?${unansweredQuery.query}`),
      ]);
      if (cancelled) {
        return;
      }

      if (overviewResult.status === 'fulfilled') {
        setOverview(overviewResult.value);
      } else {
        handleError(overviewResult.reason);
      }
      if (timeseriesResult.status === 'fulfilled') {
        setTimeseries(timeseriesResult.value);
      } else {
        handleError(timeseriesResult.reason);
      }

      if (unansweredResult.status === 'fulfilled') {
        setUnanswered(unansweredResult.value);
        setUnansweredForbidden(false);
      } else if (
        unansweredResult.reason instanceof ApiError &&
        unansweredResult.reason.status === 403
      ) {
        setUnanswered([]);
        setUnansweredForbidden(true);
      } else {
        handleError(unansweredResult.reason);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [rangeId, interval, inboxId, refreshToken, handleError]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Insights"
        title="Analytics"
        description="Answer and deflection metrics from answer_events — definitions in docs/api/rest-api.md. Times are UTC."
      />

      <Card>
        <Card.Content className="flex flex-row flex-wrap items-center gap-2">
          {ANALYTICS_RANGES.map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              variant={rangeId === preset.id ? 'primary' : 'ghost'}
              aria-pressed={rangeId === preset.id}
              onPress={() => setRangeId(preset.id)}
            >
              {preset.label}
            </Button>
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select
              aria-label="Interval"
              className="w-36"
              value={interval}
              onChange={(value) => {
                if (typeof value === 'string') {
                  setIntervalValue(value as AnalyticsInterval);
                }
              }}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {ANALYTICS_INTERVALS.map((value) => (
                    <ListBox.Item
                      key={value}
                      id={value}
                      textValue={ANALYTICS_INTERVAL_LABELS[value]}
                    >
                      {ANALYTICS_INTERVAL_LABELS[value]}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            {inboxFilterRestricted ? (
              <span className="text-xs text-muted">Inbox filter is editor/admin</span>
            ) : (
              <Select
                aria-label="Inbox"
                className="w-48"
                value={inboxId === '' ? 'all' : inboxId}
                onChange={(value) => {
                  const next = typeof value === 'string' ? value : 'all';
                  setInboxId(next === 'all' ? '' : next);
                }}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all" textValue="All inboxes">
                      All inboxes
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {inboxes.map((binding) => (
                      <ListBox.Item
                        key={binding.chatwootInboxId}
                        id={String(binding.chatwootInboxId)}
                        textValue={binding.displayName ?? `Inbox ${binding.chatwootInboxId}`}
                      >
                        {binding.displayName ?? `Inbox ${binding.chatwootInboxId}`}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            )}

            <Button
              size="sm"
              variant="ghost"
              isPending={loading}
              isDisabled={loading}
              onPress={() => setRefreshToken((current) => current + 1)}
            >
              <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
              Refresh
            </Button>
          </div>
        </Card.Content>
      </Card>

      {error ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {overview ? (
        <OverviewCards overview={overview} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-xl border border-separator bg-surface-secondary"
            />
          ))}
        </div>
      ) : null}
      {timeseries ? (
        <TimeseriesChart points={timeseries.points} interval={timeseries.interval} />
      ) : !loading ? (
        <Card>
          <Card.Content className="flex min-h-40 flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium">No chart data for this selection</p>
            <p className="max-w-md text-xs leading-5 text-muted">
              The chart fills in when messages and agent attempts are recorded for this date range
              and inbox.
            </p>
          </Card.Content>
        </Card>
      ) : null}
      {!loading || unanswered.length > 0 ? (
        <UnansweredPanel questions={unanswered} forbidden={unansweredForbidden} />
      ) : null}
    </div>
  );
}

function OverviewCards({ overview }: { overview: AnalyticsOverview }) {
  const cards: Array<{ label: string; value: string; tone: MetricTone; detail?: string }> = [
    {
      label: 'Conversations',
      value: formatCount(overview.conversations),
      tone: 'coral',
      detail: 'In the selected range',
    },
    {
      label: 'Bot-answered',
      value: formatCount(overview.botAnswered),
      tone: 'cream',
      detail: 'Handled without escalation',
    },
    {
      label: 'Deflection rate',
      value: formatRate(overview.deflectionRate),
      tone: 'mint',
      detail: 'Bot-answered share',
    },
    {
      label: 'Escalation rate',
      value: formatRate(overview.escalationRate),
      tone: 'peach',
      detail: 'Handed to a human',
    },
    { label: 'Avg latency', value: formatLatencyMs(overview.avgLatencyMs), tone: 'plain' },
    { label: 'p95 latency', value: formatLatencyMs(overview.p95LatencyMs), tone: 'plain' },
    {
      label: 'Tokens',
      value: formatTokens({ input: overview.tokensIn, output: overview.tokensOut }),
      tone: 'plain',
    },
    { label: 'Model cost', value: formatCost(overview.estimatedCostUsd), tone: 'plain' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <MetricCard
          key={card.label}
          label={card.label}
          value={card.value}
          detail={card.detail}
          tone={card.tone}
        />
      ))}
    </div>
  );
}

function TimeseriesChart({
  points,
  interval,
}: {
  points: AnalyticsPoint[];
  interval: AnalyticsInterval;
}) {
  const max = Math.max(1, ...points.map((point) => point.conversations));

  return (
    <Card>
      <Card.Header>
        <Card.Title className="text-base">Conversations vs bot answers</Card.Title>
        <Card.Description>
          Bucketed by {ANALYTICS_INTERVAL_LABELS[interval].toLowerCase()} in UTC.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-surface-tertiary" aria-hidden />
            Conversations
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-signature-coral" aria-hidden />
            Bot-answered
          </span>
        </div>

        <div aria-hidden className="flex items-end gap-1 overflow-x-auto pb-1">
          {points.map((point) => (
            <div
              key={point.bucket}
              title={`${bucketLabel(point.bucket, interval)} — ${formatCount(point.conversations)} conversations, ${formatCount(point.botAnswered)} bot-answered, deflection ${formatRate(point.deflectionRate)}`}
              className="flex min-w-7 flex-col items-center gap-1"
            >
              <div className="flex h-32 items-end gap-0.5">
                <div
                  className="w-2 rounded-t-sm bg-surface-tertiary"
                  style={{ height: `${(point.conversations / max) * 100}%` }}
                />
                <div
                  className="w-2 rounded-t-sm bg-signature-coral"
                  style={{ height: `${(point.botAnswered / max) * 100}%` }}
                />
              </div>
              <span className="whitespace-nowrap text-[10px] text-muted">
                {bucketLabel(point.bucket, interval)}
              </span>
            </div>
          ))}
        </div>

        {/* Bars are decorative; screen readers get the same numbers as a table. */}
        <table className="sr-only">
          <caption>
            Conversations vs bot answers, bucketed by{' '}
            {ANALYTICS_INTERVAL_LABELS[interval].toLowerCase()}
          </caption>
          <thead>
            <tr>
              <th scope="col">Bucket</th>
              <th scope="col">Conversations</th>
              <th scope="col">Bot-answered</th>
              <th scope="col">Deflection rate</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.bucket}>
                <th scope="row">{bucketLabel(point.bucket, interval)}</th>
                <td>{formatCount(point.conversations)}</td>
                <td>{formatCount(point.botAnswered)}</td>
                <td>{formatRate(point.deflectionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card.Content>
    </Card>
  );
}

function UnansweredPanel({
  questions,
  forbidden,
}: {
  questions: UnansweredQuestion[];
  forbidden: boolean;
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title className="text-base">Top unanswered questions</Card.Title>
      </Card.Header>
      <Card.Content className="p-0">
        {forbidden ? (
          <div className="p-4">
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Customer question text is visible to admins only.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        ) : questions.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            No unanswered questions in this range.
          </p>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Top unanswered questions" className="min-w-[520px]">
                <Table.Header>
                  <Table.Column isRowHeader>Question</Table.Column>
                  <Table.Column className="text-right">Times</Table.Column>
                  <Table.Column>Last seen</Table.Column>
                </Table.Header>
                <Table.Body items={questions}>
                  {(question) => (
                    <Table.Row id={question.query}>
                      <Table.Cell>
                        <span className="break-words text-sm">{question.query}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="text-sm text-muted">{question.count}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="whitespace-nowrap text-sm text-muted">
                          {formatTimestamp(question.lastSeen)}
                        </span>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </Card.Content>
    </Card>
  );
}
