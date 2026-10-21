'use client';

import { Alert, Button, Card, Chip, ListBox, Select, Spinner } from '@heroui/react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AnswerOutcome,
  BotState,
  ConversationDetail,
  ConversationList,
  InboxBinding,
} from '@support-agent/shared';

import { PageHeader } from '@/components/ui/page-header';
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

const BOT_STATE_COLORS: Record<BotState, 'success' | 'warning' | 'accent'> = {
  active: 'success',
  paused: 'warning',
  handed_off: 'accent',
};

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
  const [inboxFilterRestricted, setInboxFilterRestricted] = useState(false);
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

    // Rows belong to the active filters: clear them (and the selection) instead
    // of leaving the previous filter's results under the new controls.
    const key = `${rangeId}|${botState}|${inboxId}|${offset}`;
    if (filtersRef.current !== '' && filtersRef.current !== key) {
      setList(null);
      setSelectedId(null);
    }
    filtersRef.current = key;

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

  const selectedRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedId === null) {
      selectedRef.current = null;
      setDetail(null);
      return undefined;
    }
    // Selecting a different conversation must never show the previous thread.
    if (selectedRef.current !== selectedId) {
      selectedRef.current = selectedId;
      setDetail(null);
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
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operations"
        title="Conversations"
        description="Read-only explorer: messages, bot state, and per-attempt diagnostics. Ranges filter on the last message time."
      />

      <Card>
        <Card.Content className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {ANALYTICS_RANGES.map((preset) => (
              <Button
                key={preset.id}
                size="sm"
                variant={rangeId === preset.id ? 'primary' : 'ghost'}
                aria-pressed={rangeId === preset.id}
                onPress={() => {
                  setRangeId(preset.id);
                  setOffset(0);
                }}
              >
                {preset.label}
              </Button>
            ))}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select
                aria-label="Bot state"
                className="w-40"
                value={botState === '' ? 'all' : botState}
                onChange={(value) => {
                  const next = typeof value === 'string' ? value : 'all';
                  setBotState(next === 'all' ? '' : next);
                  setOffset(0);
                }}
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id="all" textValue="All states">
                      All states
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {BOT_STATE_VALUES.map((value) => (
                      <ListBox.Item key={value} id={value} textValue={BOT_STATE_LABELS[value]}>
                        {BOT_STATE_LABELS[value]}
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
                    setOffset(0);
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
                isDisabled={loading}
                onPress={() => setReloadToken((token) => token + 1)}
              >
                <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
                Refresh
              </Button>
            </div>
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

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Card>
            <Card.Header className="flex flex-row items-center justify-between gap-3">
              <Card.Title className="text-base">Conversations</Card.Title>
              <span className="rounded-md bg-surface-secondary px-2 py-0.5 text-[11px] text-muted">
                {total} total
              </span>
            </Card.Header>
            <Card.Content className="flex max-h-[min(68vh,760px)] flex-col gap-2 overflow-y-auto">
              {loading && list === null ? (
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              ) : list && list.items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No conversations match these filters.
                </p>
              ) : (
                list?.items.map((item) => {
                  const active = selectedId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? 'border-[#e7d8bf] bg-signature-cream text-ink'
                          : 'border-transparent bg-surface hover:bg-surface-secondary'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {item.contactName ?? 'Unknown contact'}
                        </span>
                        <Chip size="sm" variant="soft" color={BOT_STATE_COLORS[item.botState]}>
                          {BOT_STATE_LABELS[item.botState]}
                        </Chip>
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">
                          #{item.chatwootConversationId} · inbox {item.chatwootInboxId}
                        </span>
                        <span className="shrink-0">
                          {item.lastMessageAt ? formatTimestamp(item.lastMessageAt) : '—'}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </Card.Content>
          </Card>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              isDisabled={offset === 0 || loading}
              onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={offset + shown >= total || loading}
              onPress={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
            <span className="text-xs text-muted">{pageRangeLabel(offset, shown, total)}</span>
          </div>
        </div>

        <div className="min-w-0">
          {detailLoading && !detail ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : detail ? (
            <DetailPanel detail={detail} />
          ) : (
            <Card>
              <Card.Content className="flex min-h-64 flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm font-medium">Select a conversation</p>
                <p className="text-xs text-muted">Its thread and bot attempts appear here.</p>
              </Card.Content>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ detail }: { detail: ConversationDetail }) {
  const { conversation } = detail;

  return (
    <Card className="max-h-[min(78vh,900px)] overflow-hidden">
      <Card.Header className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <Card.Title className="truncate">
            {conversation.contactName ?? 'Unknown contact'}
          </Card.Title>
          <Card.Description>
            Inbox {conversation.chatwootInboxId} · conversation #
            {conversation.chatwootConversationId} · last message{' '}
            {conversation.lastMessageAt ? formatTimestamp(conversation.lastMessageAt) : '—'}
          </Card.Description>
        </div>
        <Chip size="sm" variant="soft" color={BOT_STATE_COLORS[conversation.botState]}>
          {BOT_STATE_LABELS[conversation.botState]}
        </Chip>
      </Card.Header>

      <Card.Content className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto">
        <section>
          <h3 className="mb-3 text-sm font-semibold">Messages</h3>
          {detail.messages.length === 0 ? (
            <p className="text-sm text-muted">No messages stored for this conversation.</p>
          ) : (
            <div className="flex max-h-[48vh] flex-col gap-2 overflow-y-auto pr-1">
              {detail.messages.map((message) => {
                const bot = message.senderType === 'bot';
                return (
                  <div key={message.id} className={`flex ${bot ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[90%] rounded-2xl border p-3 ${
                        message.isPrivate
                          ? 'border-warning/30 bg-warning/5'
                          : bot
                            ? 'rounded-br-md border-[#e7d8bf] bg-signature-cream text-ink'
                            : 'rounded-bl-md border-border bg-surface-secondary'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                        <span className="flex items-center gap-2 font-medium">
                          {SENDER_TYPE_LABELS[message.senderType]}
                          {message.isPrivate ? (
                            <Chip size="sm" variant="soft" color="warning">
                              Private note
                            </Chip>
                          ) : null}
                        </span>
                        <span className="whitespace-nowrap">
                          {formatTimestamp(message.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">
                        {message.content}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold">Bot answer attempts</h3>
          {detail.answerEventsRestricted ? (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  Answer events (query text, retrieved chunks) are visible to admins only.
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : detail.answerEvents.length === 0 ? (
            <p className="text-sm text-muted">No bot attempts recorded for this conversation.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {detail.answerEvents.map((event) => (
                <details
                  key={event.id}
                  className="group rounded-xl border border-border bg-surface-secondary/50 p-3"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                    <Chip size="sm" variant="soft" color={outcomeColor(event.outcome)}>
                      {OUTCOME_LABELS[event.outcome]}
                    </Chip>
                    <span className="text-xs text-muted">{formatTimestamp(event.createdAt)}</span>
                    <span className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <span>score {formatScore(event.topScore)}</span>
                      <span aria-hidden>·</span>
                      <span>{event.totalMs === null ? '—' : formatLatencyMs(event.totalMs)}</span>
                      <span aria-hidden>·</span>
                      <span>
                        {event.tokensIn === null && event.tokensOut === null
                          ? '— tokens'
                          : formatTokens({
                              input: event.tokensIn ?? 0,
                              output: event.tokensOut ?? 0,
                            })}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        {event.estimatedCostUsd === null ? '—' : formatCost(event.estimatedCostUsd)}
                      </span>
                    </span>
                    <ChevronDown
                      className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                  </summary>

                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-xs text-muted">
                      “{event.queryText}” — {event.retrievedChunks.length} retrieved chunks · topK{' '}
                      {event.topK ?? '—'} · {event.chatModel ?? 'model unknown'}
                    </p>
                    {event.retrievedChunks.map((chunk) => (
                      <div
                        key={chunk.id}
                        className="rounded-lg border border-border bg-background/60 p-2.5 text-xs"
                      >
                        <p className="mb-1 text-muted">
                          {chunk.documentFilename ?? 'document'} · chunk {chunk.chunkIndex}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{chunk.content}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </Card.Content>
    </Card>
  );
}

function outcomeColor(outcome: AnswerOutcome): 'default' | 'warning' | 'success' {
  if (outcome === 'error') {
    return 'default';
  }
  return isEscalationOutcome(outcome) ? 'warning' : 'success';
}
