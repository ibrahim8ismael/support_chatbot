'use client';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Label,
  Spinner,
  TextArea,
  TextField,
} from '@heroui/react';
import { Send, Sparkles, TestTube2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import type { AgentAnswer, KnowledgeBaseSummary } from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';
import {
  MAX_KB_SELECTION,
  buildAskPayload,
  chunkSource,
  escalationLabel,
  formatLatency,
  formatScore,
  formatTokens,
  type PlaygroundExchange,
} from '@/lib/playground';

export function PlaygroundView({
  onSaveCase,
}: {
  /** Called from an exchange; the Sandbox shell opens a prefilled case form. */
  onSaveCase?: (question: string, answer: AgentAnswer, kbIds: string[]) => void;
}) {
  const router = useRouter();
  const [kbs, setKbs] = useState<KnowledgeBaseSummary[]>([]);
  const [loadingKbs, setLoadingKbs] = useState(true);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<PlaygroundExchange[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await apiFetch<KnowledgeBaseSummary[]>('/knowledge-bases');
        if (!cancelled) {
          setKbs(list);
        }
      } catch (cause) {
        if (cancelled) {
          return;
        }
        if (cause instanceof ApiError && cause.status === 401) {
          router.push('/login');
        } else {
          setError(cause instanceof Error ? cause.message : 'Something went wrong');
        }
      } finally {
        if (!cancelled) {
          setLoadingKbs(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function toggleKb(kbId: string): void {
    setSelectedKbIds((current) =>
      current.includes(kbId) ? current.filter((id) => id !== kbId) : [...current, kbId],
    );
  }

  async function onAsk(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const built = buildAskPayload(question, selectedKbIds, exchanges);
    if (!built.ok) {
      setError(built.error);
      return;
    }

    setAsking(true);
    setError(null);
    const asked = question.trim();
    const askedKbIds = [...selectedKbIds];
    try {
      const answer = await apiFetch<AgentAnswer>('/playground/ask', {
        method: 'POST',
        body: JSON.stringify(built.payload),
      });
      setExchanges((current) => [...current, { question: asked, answer, kbIds: askedKbIds }]);
      // Only clear the draft if the user hasn't typed a new question meanwhile.
      setQuestion((current) => (current.trim() === asked ? '' : current));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.push('/login');
      } else {
        setError(cause instanceof Error ? cause.message : 'Ask failed');
      }
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <Card.Header>
              <Card.Title className="text-base">Knowledge bases</Card.Title>
              <Card.Description>
                Select up to {MAX_KB_SELECTION} sources to search.
              </Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-3">
              {loadingKbs ? (
                <div className="flex justify-center py-4">
                  <Spinner size="sm" />
                </div>
              ) : kbs.length === 0 ? (
                <p className="text-sm text-muted">
                  Nothing to ask yet —{' '}
                  <Link href="/knowledge-bases" className="font-medium text-accent hover:underline">
                    create a knowledge base
                  </Link>{' '}
                  and upload documents.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {kbs.map((kb) => (
                    <Checkbox
                      key={kb.id}
                      variant="secondary"
                      isSelected={selectedKbIds.includes(kb.id)}
                      onChange={() => toggleKb(kb.id)}
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm">{kb.name}</span>
                          {kb.status === 'archived' ? (
                            <Chip size="sm" variant="soft">
                              Archived
                            </Chip>
                          ) : null}
                        </span>
                      </Checkbox.Content>
                    </Checkbox>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted">
                {selectedKbIds.length}/{MAX_KB_SELECTION} selected
              </p>
            </Card.Content>
          </Card>

          <Card>
            <Card.Header>
              <Card.Title className="text-base">Ask the agent</Card.Title>
              <Card.Description>
                Answers cite the chunks they used. Nothing is sent to customers.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <form onSubmit={onAsk} className="flex flex-col gap-3">
                <TextField value={question} onChange={setQuestion} isRequired>
                  <Label>Question</Label>
                  <TextArea
                    rows={4}
                    maxLength={2000}
                    disabled={asking}
                    placeholder="How do I reset my password?"
                  />
                </TextField>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted">{question.length}/2000</span>
                  <Button
                    type="submit"
                    isPending={asking}
                    isDisabled={
                      asking ||
                      selectedKbIds.length === 0 ||
                      selectedKbIds.length > MAX_KB_SELECTION ||
                      question.trim().length === 0
                    }
                  >
                    <Send className="size-4" aria-hidden />
                    Ask
                  </Button>
                </div>
              </form>
            </Card.Content>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {exchanges.length === 0 ? (
            <Card className="h-full">
              <Card.Content className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                <Sparkles className="size-8 text-muted" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No answers yet</p>
                  <p className="text-xs text-muted">
                    Answers, grounded chunks and scores appear here.
                  </p>
                </div>
              </Card.Content>
            </Card>
          ) : (
            exchanges.map((exchange, index) => (
              <ExchangeCard key={index} exchange={exchange} onSaveCase={onSaveCase} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ExchangeCard({
  exchange,
  onSaveCase,
}: {
  exchange: PlaygroundExchange;
  onSaveCase?: (question: string, answer: AgentAnswer, kbIds: string[]) => void;
}): ReactNode {
  const { question, answer, kbIds } = exchange;

  return (
    <Card>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background">
            Q
          </span>
          <p className="min-w-0 text-sm font-medium break-words whitespace-pre-wrap">{question}</p>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            answer.escalated
              ? 'border-signature-coral/30 bg-[#fbe9e1]'
              : 'border-[#e7d8bf] bg-signature-cream'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft" color={answer.escalated ? 'danger' : 'success'}>
              {answer.escalated ? 'Escalated' : 'Answered'}
            </Chip>
            {answer.escalated ? (
              <span className="text-xs text-muted">{escalationLabel(answer.escalationReason)}</span>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {answer.answer}
          </p>
        </div>

        {answer.chunks.length > 0 ? (
          <div>
            <h4 className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
              Grounded chunks
            </h4>
            <ul className="flex flex-col gap-2">
              {answer.chunks.map((chunk) => (
                <li
                  key={chunk.id}
                  className="rounded-lg border border-border bg-surface-secondary p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="truncate">{chunkSource(chunk)}</span>
                    <Chip size="sm" variant="soft">
                      {formatScore(chunk.score)}
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

        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{answer.model ?? 'no model call'}</span>
          <span aria-hidden>·</span>
          <span>{answer.promptVersion}</span>
          <span aria-hidden>·</span>
          <span>{formatLatency(answer.latency)}</span>
          <span aria-hidden>·</span>
          <span>{formatTokens(answer.tokens)}</span>
        </p>

        {onSaveCase ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onPress={() => onSaveCase(question, answer, kbIds ?? [])}
            >
              <TestTube2 className="size-4" aria-hidden />
              Save as test case
            </Button>
          </div>
        ) : null}
      </Card.Content>
    </Card>
  );
}
