'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  type AnswerOutcome,
  type BotState,
  type ConversationDetail,
  type ConversationList,
  type InboxBinding,
} from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';
import {
  ANALYTICS_RANGES,
  type AnalyticsRangeId,
  formatCost,
  formatLatencyMs,
  formatTimestamp,
  rangeFor,
} from '@/lib/analytics';
import {
  BOT_STATE_LABELS,
  OUTCOME_LABELS,
  SENDER_TYPE_LABELS,
  buildConversationListQuery,
  formatScore,
  isEscalationOutcome,
  pageRangeLabel,
} from '@/lib/conversations';
import { formatTokens } from '@/lib/playground';

const PAGE_SIZE = 50;
const BOT_STATE_VALUES = ['active', 'paused', 'handed_off'] as const;

/**
 * Conversation explorer (T-303): read-only list + thread view with per-attempt
 * diagnostics. Answer events (query text, retrieved chunks) are admin-only
 * (security.md § 4) — the API flags this with `answerEventsRestricted`.
 */
export function ConversationsView() {
  const router = useRouter();
  const [rangeId, setRangeId] = useState<AnalyticsRangeId>('30d');
  const [botState, setBotState] = useState('');
  const [inboxId, setInboxId] = useState('');
  const [inboxes, setInboxes] = useState<InboxBinding[]>([]);
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<ConversationList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
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
    const parsed = buildConversationListQuery({
      from,
      to,
      limit: PAGE_SIZE,
      offset,
      ...(inboxId === '' ? {} : { inboxId: Number(inboxId) }),
      ...(botState === '' ? {} : { botState: botState as BotState }),
    });
    if (!parsed.ok) {
      setError('Invalid filters');
      setLoading(false);
      return;
    }

    void apiFetch<ConversationList>(`/conversations?${parsed.query}`)
      .then((result) => {
        if (!cancelled) {
          setList(result);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          handleError(cause);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rangeId, botState, inboxId, offset, reloadToken, handleError]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void apiFetch<ConversationDetail>(`/conversations/${selectedId}`)
      .then((result) => {
        if (!cancelled) {
          setDetail(result);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        setDetail(null);
        if (cause instanceof ApiError && cause.status === 404) {
          setError('Conversation not found');
        } else {
          handleError(cause);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, reloadToken, handleError]);

  const shown = list?.items.length ?? 0;
  const total = list?.total ?? 0;

  return (
    <>
      <h1>Conversations</h1>
      <p style={{ color: 'var(--legacy-muted)' }}>
        Read-only explorer: messages, bot state, and per-attempt diagnostics. Ranges filter on the
        last message time.
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
            onClick={() => {
              setRangeId(preset.id);
              setOffset(0);
            }}
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
          Bot state{' '}
          <select
            value={botState}
            onChange={(event) => {
              setBotState(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">All states</option>
            {BOT_STATE_VALUES.map((value) => (
              <option key={value} value={value}>
                {BOT_STATE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label style={{ color: 'var(--legacy-muted)' }}>
          Inbox{' '}
          <select
            value={inboxId}
            onChange={(event) => {
              setInboxId(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">All inboxes</option>
            {inboxes.map((binding) => (
              <option key={binding.chatwootInboxId} value={binding.chatwootInboxId}>
                {binding.displayName ?? `Inbox ${binding.chatwootInboxId}`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          style={{
            padding: '4px 10px',
            border: '1px solid var(--legacy-border)',
            borderRadius: 999,
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
        {loading ? <span style={{ color: 'var(--legacy-muted)' }}>Loading…</span> : null}
      </div>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 380px', minWidth: 320 }}>
          {list && list.items.length === 0 && !loading ? (
            <p style={{ color: 'var(--legacy-muted)' }}>No conversations match these filters.</p>
          ) : null}
          {list && list.items.length > 0 ? (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--legacy-muted)', fontSize: 12 }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>Contact</th>
                  <th style={{ padding: '4px 8px' }}>State</th>
                  <th style={{ padding: '4px 0 4px 8px' }}>Last message</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    style={{
                      cursor: 'pointer',
                      borderTop: '1px solid var(--legacy-border)',
                      background: selectedId === item.id ? 'rgba(37, 99, 235, 0.08)' : undefined,
                    }}
                  >
                    <td style={{ padding: '6px 8px 6px 0' }}>
                      <div>{item.contactName ?? 'Unknown contact'}</div>
                      <div style={{ color: 'var(--legacy-muted)', fontSize: 11 }}>
                        #{item.chatwootConversationId} · inbox {item.chatwootInboxId}
                      </div>
                    </td>
                    <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      {BOT_STATE_LABELS[item.botState]}
                    </td>
                    <td style={{ padding: '6px 0 6px 8px', whiteSpace: 'nowrap' }}>
                      {item.lastMessageAt ? formatTimestamp(item.lastMessageAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + shown >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
            <span style={{ color: 'var(--legacy-muted)', fontSize: 12 }}>
              {pageRangeLabel(offset, shown, total)}
            </span>
          </div>
        </div>

        <div style={{ flex: '2 1 520px', minWidth: 320 }}>
          {detailLoading && !detail ? (
            <p style={{ color: 'var(--legacy-muted)' }}>Loading conversation…</p>
          ) : detail ? (
            <DetailPanel detail={detail} />
          ) : (
            <p style={{ color: 'var(--legacy-muted)' }}>Select a conversation to see its thread.</p>
          )}
        </div>
      </div>
    </>
  );
}

function DetailPanel({ detail }: { detail: ConversationDetail }) {
  const { conversation } = detail;

  return (
    <div style={{ border: '1px solid var(--legacy-border)', borderRadius: 8, padding: 16 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{conversation.contactName ?? 'Unknown contact'}</h2>
      <div style={{ color: 'var(--legacy-muted)', fontSize: 12, margin: '4px 0 12px' }}>
        Inbox {conversation.chatwootInboxId} · conversation #{conversation.chatwootConversationId} ·{' '}
        {BOT_STATE_LABELS[conversation.botState]} · last message{' '}
        {conversation.lastMessageAt ? formatTimestamp(conversation.lastMessageAt) : '—'}
      </div>

      <h3 style={{ fontSize: 14, margin: '12px 0 8px' }}>Messages</h3>
      {detail.messages.length === 0 ? (
        <p style={{ color: 'var(--legacy-muted)' }}>No messages stored for this conversation.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {detail.messages.map((message) => (
            <div
              key={message.id}
              style={{
                border: '1px solid var(--legacy-border)',
                borderLeft: `3px solid ${
                  message.isPrivate
                    ? '#b45309'
                    : message.senderType === 'bot'
                      ? '#2563eb'
                      : 'var(--legacy-muted)'
                }`,
                borderRadius: 6,
                padding: '8px 10px',
                background: message.isPrivate ? 'rgba(180, 83, 9, 0.06)' : undefined,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: 11,
                  color: 'var(--legacy-muted)',
                }}
              >
                <span>
                  {SENDER_TYPE_LABELS[message.senderType]}
                  {message.isPrivate ? ' · private note' : ''}
                </span>
                <span style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(message.createdAt)}</span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{message.content}</div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 14, margin: '16px 0 8px' }}>Bot answer attempts</h3>
      {detail.answerEventsRestricted ? (
        <p style={{ color: 'var(--legacy-muted)' }}>
          Answer events (query text, retrieved chunks) are visible to admins only.
        </p>
      ) : detail.answerEvents.length === 0 ? (
        <p style={{ color: 'var(--legacy-muted)' }}>
          No bot attempts recorded for this conversation.
        </p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--legacy-muted)', fontSize: 12 }}>
              <th style={{ padding: '4px 8px 4px 0' }}>Time</th>
              <th style={{ padding: '4px 8px' }}>Outcome</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Score</th>
              <th style={{ padding: '4px 8px', textAlign: 'right' }}>Latency</th>
              <th style={{ padding: '4px 8px' }}>Tokens</th>
              <th style={{ padding: '4px 0 4px 8px', textAlign: 'right' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {detail.answerEvents.map((event) => (
              <Fragment key={event.id}>
                <tr style={{ borderTop: '1px solid var(--legacy-border)' }}>
                  <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap' }}>
                    {formatTimestamp(event.createdAt)}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <span style={outcomeChip(event.outcome)}>{OUTCOME_LABELS[event.outcome]}</span>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {formatScore(event.topScore)}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {event.totalMs === null ? '—' : formatLatencyMs(event.totalMs)}
                  </td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {event.tokensIn === null && event.tokensOut === null
                      ? '—'
                      : formatTokens({ input: event.tokensIn ?? 0, output: event.tokensOut ?? 0 })}
                  </td>
                  <td
                    style={{ padding: '6px 0 6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}
                  >
                    {event.estimatedCostUsd === null ? '—' : formatCost(event.estimatedCostUsd)}
                  </td>
                </tr>
                <tr>
                  <td colSpan={6} style={{ padding: '0 0 6px' }}>
                    <details>
                      <summary
                        style={{ cursor: 'pointer', color: 'var(--legacy-muted)', fontSize: 12 }}
                      >
                        “{event.queryText}” — {event.retrievedChunks.length} retrieved chunks · topK{' '}
                        {event.topK ?? '—'} · {event.chatModel ?? 'model unknown'}
                      </summary>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                          marginTop: 6,
                        }}
                      >
                        {event.retrievedChunks.map((chunk) => (
                          <div
                            key={chunk.id}
                            style={{
                              border: '1px solid var(--legacy-border)',
                              borderRadius: 6,
                              padding: '6px 8px',
                              fontSize: 12,
                            }}
                          >
                            <div style={{ color: 'var(--legacy-muted)', marginBottom: 2 }}>
                              {chunk.documentFilename ?? 'document'} · chunk {chunk.chunkIndex}
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap' }}>{chunk.content}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function outcomeChip(outcome: AnswerOutcome): React.CSSProperties {
  const palette =
    outcome === 'error'
      ? { background: 'rgba(107, 114, 128, 0.15)', color: '#6b7280' }
      : isEscalationOutcome(outcome)
        ? { background: 'rgba(180, 83, 9, 0.12)', color: '#b45309' }
        : { background: 'rgba(37, 99, 235, 0.12)', color: '#2563eb' };
  return {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: 999,
    fontSize: 12,
    whiteSpace: 'nowrap',
    ...palette,
  };
}
