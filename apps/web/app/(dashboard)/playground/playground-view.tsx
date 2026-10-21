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
import { Bot, FileText, RotateCcw, Send, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

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

export function PlaygroundView() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KnowledgeBaseSummary[]>([]);
  const [loadingKbs, setLoadingKbs] = useState(true);
  const [selectedKbIds, setSelectedKbIds] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<PlaygroundExchange[]>([]);
  const [asking, setAsking] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const readyKbs = kbs.filter((kb) => kb.status === 'active' && kb.statusCounts.ready > 0);

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
          setError(cause instanceof Error ? cause.message : 'Could not load knowledge bases');
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

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });
    }
  }, [exchanges, pendingQuestion, asking]);

  function toggleKb(kbId: string): void {
    setSelectedKbIds((current) => {
      if (current.includes(kbId)) {
        return current.filter((id) => id !== kbId);
      }
      if (current.length >= MAX_KB_SELECTION) {
        setError(`Choose up to ${MAX_KB_SELECTION} knowledge bases.`);
        return current;
      }
      return [...current, kbId];
    });
    setError(null);
  }

  async function onAsk(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const built = buildAskPayload(question, selectedKbIds, exchanges);
    if (!built.ok) {
      setError(built.error);
      return;
    }

    const asked = question.trim();
    const askedKbIds = [...selectedKbIds];
    setAsking(true);
    setPendingQuestion(asked);
    setError(null);
    try {
      const answer = await apiFetch<AgentAnswer>('/playground/ask', {
        method: 'POST',
        body: JSON.stringify(built.payload),
      });
      setExchanges((current) => [...current, { question: asked, answer, kbIds: askedKbIds }]);
      setQuestion((current) => (current.trim() === asked ? '' : current));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.push('/login');
      } else {
        setError(cause instanceof Error ? cause.message : 'The agent could not answer');
      }
    } finally {
      setPendingQuestion(null);
      setAsking(false);
    }
  }

  function clearChat(): void {
    setExchanges([]);
    setPendingQuestion(null);
    setQuestion('');
    setError(null);
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {error ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Could not complete the request</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(230px,290px)_minmax(0,1fr)]">
        <Card className="h-fit">
          <Card.Header>
            <Card.Title className="text-base">Document sources</Card.Title>
            <Card.Description>The agent searches only the sources checked here.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {loadingKbs ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted" role="status">
                <Spinner size="sm" /> Loading knowledge bases…
              </div>
            ) : readyKbs.length === 0 ? (
              <div className="rounded-lg bg-surface-secondary p-3 text-sm text-muted">
                No active knowledge base has a ready document yet. Upload and process a PDF, DOCX,
                TXT or MD file first.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {readyKbs.map((kb) => (
                  <Checkbox
                    key={kb.id}
                    variant="secondary"
                    isSelected={selectedKbIds.includes(kb.id)}
                    isDisabled={
                      asking ||
                      (!selectedKbIds.includes(kb.id) && selectedKbIds.length >= MAX_KB_SELECTION)
                    }
                    onChange={() => toggleKb(kb.id)}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{kb.name}</span>
                        <span className="text-xs text-muted">
                          {kb.statusCounts.ready} ready document
                          {kb.statusCounts.ready === 1 ? '' : 's'}
                        </span>
                      </span>
                    </Checkbox.Content>
                  </Checkbox>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between border-t border-separator pt-3 text-xs text-muted">
              <span>Selected sources</span>
              <span>
                {selectedKbIds.length}/{MAX_KB_SELECTION}
              </span>
            </div>
            {selectedKbIds.length === 0 && readyKbs.length > 0 ? (
              <p className="text-xs text-warning">Select at least one source to start chatting.</p>
            ) : null}
          </Card.Content>
        </Card>

        <Card className="flex min-h-[68vh] min-w-0 flex-col overflow-hidden">
          <Card.Header className="flex flex-row items-center justify-between gap-3 border-b border-separator">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signature-cream text-ink">
                <Bot className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <Card.Title className="text-base">Agent sandbox</Card.Title>
                <Card.Description className="truncate">
                  {selectedKbIds.length > 0
                    ? `${selectedKbIds.length} selected source${selectedKbIds.length === 1 ? '' : 's'}`
                    : 'Select document sources to begin'}
                </Card.Description>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={asking || exchanges.length === 0}
              onPress={clearChat}
            >
              <RotateCcw className="size-4" aria-hidden />
              Clear chat
            </Button>
          </Card.Header>

          <div
            ref={threadRef}
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-surface-secondary/50 p-4 sm:p-6"
            aria-label="Sandbox conversation"
            aria-live="polite"
          >
            {exchanges.length === 0 && !pendingQuestion ? (
              <div className="m-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-signature-cream text-ink">
                  <Sparkles className="size-6" aria-hidden />
                </span>
                <div className="space-y-1">
                  <p className="font-medium">Start a grounded conversation</p>
                  <p className="text-sm leading-6 text-muted">
                    Select one or more document knowledge bases, then ask a question. The reply
                    includes the retrieved passages so you can verify its source.
                  </p>
                </div>
              </div>
            ) : null}

            {exchanges.map((exchange, index) => (
              <ChatExchange key={`${index}-${exchange.question}`} exchange={exchange} />
            ))}

            {pendingQuestion ? (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-6 text-background">
                    {pendingQuestion}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-signature-cream text-ink">
                    <Bot className="size-4" aria-hidden />
                  </span>
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-separator bg-surface px-4 py-3 text-sm text-muted">
                    <Spinner size="sm" /> Searching selected documents…
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <Card.Content className="border-t border-separator bg-surface p-3 sm:p-4">
            <form onSubmit={(event) => void onAsk(event)} className="flex items-end gap-2">
              <TextField
                className="min-w-0 flex-1"
                value={question}
                onChange={setQuestion}
                isRequired
              >
                <Label className="sr-only">Ask the agent</Label>
                <TextArea
                  rows={2}
                  maxLength={2000}
                  disabled={asking || selectedKbIds.length === 0}
                  placeholder={
                    selectedKbIds.length === 0
                      ? 'Select at least one document source…'
                      : 'Ask a question about the selected documents…'
                  }
                />
              </TextField>
              <Button
                type="submit"
                isPending={asking}
                isDisabled={
                  asking ||
                  loadingKbs ||
                  selectedKbIds.length === 0 ||
                  selectedKbIds.length > MAX_KB_SELECTION ||
                  question.trim().length === 0
                }
                aria-label="Send message"
              >
                <Send className="size-4" aria-hidden />
                <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
            <p className="mt-2 text-right text-[11px] text-muted">
              {question.length}/2000 · Sandbox replies are not sent to Chatwoot
            </p>
          </Card.Content>
        </Card>
      </div>
    </div>
  );
}

function ChatExchange({ exchange }: { exchange: PlaygroundExchange }) {
  const { question, answer } = exchange;
  return (
    <>
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-6 text-background">
          <p className="whitespace-pre-wrap break-words">{question}</p>
        </div>
      </div>

      <div className="flex min-w-0 items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-signature-cream text-ink">
          <Bot className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 max-w-[92%] flex-1 rounded-2xl rounded-bl-md border border-separator bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" variant="soft" color={answer.escalated ? 'warning' : 'success'}>
              {answer.escalated ? 'Needs a human' : 'Grounded answer'}
            </Chip>
            {answer.escalated ? (
              <span className="text-xs text-muted">{escalationLabel(answer.escalationReason)}</span>
            ) : null}
          </div>
          <p className="mt-3 text-sm leading-6 break-words whitespace-pre-wrap">{answer.answer}</p>

          {answer.chunks.length > 0 ? (
            <details className="group mt-4 border-t border-separator pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted">
                <FileText className="size-3.5" aria-hidden />
                Sources used ({answer.chunks.length})
                <span className="ml-auto transition-transform group-open:rotate-180" aria-hidden>
                  ▾
                </span>
              </summary>
              <ul className="mt-3 flex flex-col gap-2">
                {answer.chunks.map((chunk) => (
                  <li key={chunk.id} className="rounded-lg bg-surface-secondary p-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="truncate">{chunkSource(chunk)}</span>
                      <Chip size="sm" variant="soft">
                        {formatScore(chunk.score)}
                      </Chip>
                    </div>
                    <p className="mt-2 text-sm leading-5 break-words whitespace-pre-wrap text-foreground/80">
                      {chunk.content}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <p className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted">
            <span>{answer.model ?? 'No model call'}</span>
            <span aria-hidden>·</span>
            <span>{formatLatency(answer.latency)}</span>
            <span aria-hidden>·</span>
            <span>{formatTokens(answer.tokens)}</span>
          </p>
        </div>
      </div>
    </>
  );
}
