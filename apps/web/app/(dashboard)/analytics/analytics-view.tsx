'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  ANALYTICS_INTERVALS,
  type AnalyticsInterval,
  type AnalyticsOverview,
  type AnalyticsPoint,
  type AnalyticsTimeseries,
  type InboxBinding,
  type UnansweredQuestion,
} from '@support-agent/shared';

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
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [timeseries, setTimeseries] = useState<AnalyticsTimeseries | null>(null);
  const [unanswered, setUnanswered] = useState<UnansweredQuestion[]>([]);
  const [unansweredForbidden, setUnansweredForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Inbox filter options — bindings are editor/admin; viewers keep "All inboxes".
  useEffect(() => {
    let cancelled = false;
    apiFetch<InboxBinding[]>('/bindings')
      .then((rows) => {
        if (!cancelled) {
          setInboxes(rows);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled && cause instanceof ApiError && cause.status === 401) {
          router.push('/login');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;
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
  }, [rangeId, interval, inboxId, handleError]);

  return (
    <>
      <h1>Analytics</h1>
      <p style={{ color: 'var(--legacy-muted)' }}>
        Answer and deflection metrics from answer_events — definitions in docs/api/rest-api.md.
        Times are UTC.
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          margin: '12px 0',
        }}
      >
        {ANALYTICS_RANGES.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-pressed={rangeId === preset.id}
            onClick={() => setRangeId(preset.id)}
            style={{
              padding: '4px 10px',
              border: '1px solid var(--legacy-border)',
              borderRadius: 999,
              background: rangeId === preset.id ? '#2563eb' : 'transparent',
              color: rangeId === preset.id ? 'white' : 'inherit',
              cursor: 'pointer',
            }}
          >
            {preset.label}
          </button>
        ))}
        <label style={{ color: 'var(--legacy-muted)' }}>
          Interval{' '}
          <select
            value={interval}
            onChange={(event) => setIntervalValue(event.target.value as AnalyticsInterval)}
          >
            {ANALYTICS_INTERVALS.map((value) => (
              <option key={value} value={value}>
                {ANALYTICS_INTERVAL_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ color: 'var(--legacy-muted)' }}>
          Inbox{' '}
          <select value={inboxId} onChange={(event) => setInboxId(event.target.value)}>
            <option value="">All inboxes</option>
            {inboxes.map((binding) => (
              <option key={binding.chatwootInboxId} value={binding.chatwootInboxId}>
                {binding.displayName ?? `Inbox ${binding.chatwootInboxId}`}
              </option>
            ))}
          </select>
        </label>
        {loading ? <span style={{ color: 'var(--legacy-muted)' }}>Loading…</span> : null}
      </div>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {overview ? <OverviewCards overview={overview} /> : null}
      {timeseries && timeseries.points.length > 0 ? (
        <TimeseriesChart points={timeseries.points} interval={timeseries.interval} />
      ) : null}
      <UnansweredPanel questions={unanswered} forbidden={unansweredForbidden} />
    </>
  );
}

function OverviewCards({ overview }: { overview: AnalyticsOverview }) {
  const cards: Array<{ label: string; value: string }> = [
    { label: 'Conversations', value: formatCount(overview.conversations) },
    { label: 'Bot-answered', value: formatCount(overview.botAnswered) },
    { label: 'Deflection rate', value: formatRate(overview.deflectionRate) },
    { label: 'Escalation rate', value: formatRate(overview.escalationRate) },
    { label: 'Avg latency', value: formatLatencyMs(overview.avgLatencyMs) },
    { label: 'p95 latency', value: formatLatencyMs(overview.p95LatencyMs) },
    {
      label: 'Tokens',
      value: formatTokens({ input: overview.tokensIn, output: overview.tokensOut }),
    },
    { label: 'Model cost', value: formatCost(overview.estimatedCostUsd) },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 12,
        margin: '16px 0',
      }}
    >
      {cards.map((card) => (
        <div
          key={card.label}
          style={{ border: '1px solid var(--legacy-border)', borderRadius: 8, padding: 12 }}
        >
          <div style={{ color: 'var(--legacy-muted)', fontSize: 12 }}>{card.label}</div>
          <div style={{ fontSize: 22, marginTop: 4 }}>{card.value}</div>
        </div>
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
    <div
      style={{
        border: '1px solid var(--legacy-border)',
        borderRadius: 8,
        padding: 16,
        margin: '16px 0',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Conversations vs bot answers</h2>
      <div
        style={{
          display: 'flex',
          gap: 12,
          color: 'var(--legacy-muted)',
          fontSize: 12,
          margin: '8px 0',
        }}
      >
        <span>
          <span style={swatch('var(--legacy-muted)')} /> Conversations
        </span>
        <span>
          <span style={swatch('#2563eb')} /> Bot-answered
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 4,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        {points.map((point) => (
          <div
            key={point.bucket}
            title={
              `${bucketLabel(point.bucket, interval)} — ${formatCount(point.conversations)} conversations, ` +
              `${formatCount(point.botAnswered)} bot-answered, deflection ${formatRate(point.deflectionRate)}`
            }
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              minWidth: 26,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
              <div
                style={{
                  width: 9,
                  height: `${(point.conversations / max) * 120}px`,
                  background: 'var(--legacy-muted)',
                }}
              />
              <div
                style={{
                  width: 9,
                  height: `${(point.botAnswered / max) * 120}px`,
                  background: '#2563eb',
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: 'var(--legacy-muted)', whiteSpace: 'nowrap' }}>
              {bucketLabel(point.bucket, interval)}
            </span>
          </div>
        ))}
      </div>
    </div>
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
    <div
      style={{
        border: '1px solid var(--legacy-border)',
        borderRadius: 8,
        padding: 16,
        margin: '16px 0',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 16 }}>Top unanswered questions</h2>
      {forbidden ? (
        <p style={{ color: 'var(--legacy-muted)' }}>
          Customer question text is visible to admins only.
        </p>
      ) : questions.length === 0 ? (
        <p style={{ color: 'var(--legacy-muted)' }}>No unanswered questions in this range.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 8 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--legacy-muted)', fontSize: 12 }}>
              <th style={{ padding: '4px 8px 4px 0' }}>Question</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Times</th>
              <th style={{ padding: '4px 0 4px 8px' }}>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => (
              <tr key={question.query} style={{ borderTop: '1px solid var(--legacy-border)' }}>
                <td style={{ padding: '6px 8px 6px 0' }}>{question.query}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{question.count}</td>
                <td style={{ padding: '6px 0 6px 8px', whiteSpace: 'nowrap' }}>
                  {formatTimestamp(question.lastSeen)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function swatch(color: string): React.CSSProperties {
  return { display: 'inline-block', width: 10, height: 10, background: color, marginRight: 4 };
}
