'use client';

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

export function PlaygroundView() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KnowledgeBaseSummary[]>([]);
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
    try {
      const answer = await apiFetch<AgentAnswer>('/playground/ask', {
        method: 'POST',
        body: JSON.stringify(built.payload),
      });
      setExchanges((current) => [...current, { question: question.trim(), answer }]);
      setQuestion('');
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
    <>
      <h1>Playground</h1>
      <p style={{ color: 'var(--legacy-muted)' }}>
        Ask a question against selected knowledge bases — the exact answer path (retrieval +
        grounding + output guard) with no Chatwoot involvement.
      </p>

      <section
        style={{
          display: 'grid',
          gap: 24,
          gridTemplateColumns: 'minmax(240px, 320px) 1fr',
          marginTop: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 16 }}>Knowledge bases</h2>
          {kbs.length === 0 ? (
            <p style={{ color: 'var(--legacy-muted)' }}>
              Nothing to ask yet — <Link href="/knowledge-bases">create a knowledge base</Link> and
              upload documents.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {kbs.map((kb) => (
                <li key={kb.id}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedKbIds.includes(kb.id)}
                      onChange={() => toggleKb(kb.id)}
                    />
                    <span>
                      {kb.name}
                      {kb.status === 'archived' ? ' (archived)' : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p style={{ color: 'var(--legacy-muted)', fontSize: 13 }}>
            {selectedKbIds.length}/{MAX_KB_SELECTION} selected
          </p>

          <form onSubmit={onAsk} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <label>
              Question
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={3}
                maxLength={2000}
                style={{ width: '100%' }}
              />
            </label>
            <button type="submit" disabled={asking}>
              {asking ? 'Asking…' : 'Ask'}
            </button>
          </form>
          {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
        </div>

        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          {exchanges.length === 0 ? (
            <p style={{ color: 'var(--legacy-muted)' }}>
              Answers, grounded chunks, and scores appear here.
            </p>
          ) : (
            exchanges.map((exchange, index) => <ExchangeCard key={index} exchange={exchange} />)
          )}
        </div>
      </section>
    </>
  );
}

function ExchangeCard({ exchange }: { exchange: PlaygroundExchange }): ReactNode {
  const { question, answer } = exchange;

  return (
    <article
      style={{ border: '1px solid var(--legacy-border)', padding: 12, display: 'grid', gap: 8 }}
    >
      <p style={{ margin: 0 }}>
        <strong>Q:</strong> {question}
      </p>
      <div
        style={{
          padding: 10,
          background: answer.escalated ? 'rgba(220, 38, 38, 0.08)' : 'rgba(21, 128, 61, 0.08)',
        }}
      >
        <p style={{ margin: 0 }}>{answer.answer}</p>
        {answer.escalated ? (
          <p style={{ margin: '6px 0 0', color: 'crimson', fontSize: 13 }}>
            Escalated — {escalationLabel(answer.escalationReason)}
          </p>
        ) : null}
      </div>

      {answer.chunks.length > 0 ? (
        <div>
          <h3 style={{ fontSize: 14, margin: '4px 0' }}>Grounded chunks</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {answer.chunks.map((chunk) => (
              <li key={chunk.id} style={{ border: '1px solid var(--legacy-border)', padding: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: 'var(--legacy-muted)' }}>{chunkSource(chunk)}</span>
                  <span style={{ fontFamily: 'monospace' }}>{formatScore(chunk.score)}</span>
                </div>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    margin: '6px 0 0',
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                >
                  {chunk.content}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p style={{ margin: 0, color: 'var(--legacy-muted)', fontSize: 13 }}>
        {answer.model ?? 'no model call'} · {answer.promptVersion} · {formatLatency(answer.latency)}{' '}
        · {formatTokens(answer.tokens)}
      </p>
    </article>
  );
}
