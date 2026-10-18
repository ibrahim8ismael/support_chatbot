'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { InboxBinding, KnowledgeBaseSummary } from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';

interface Draft {
  enabled: boolean;
  kbIds: string[];
}

function toggleKb(ids: string[], kbId: string): string[] {
  return ids.includes(kbId) ? ids.filter((id) => id !== kbId) : [...ids, kbId];
}

/**
 * Inbox bindings (T-304): map Chatwoot inboxes to knowledge bases and toggle
 * the per-inbox kill switch. Writes are editor/admin (security.md § 2) — other
 * roles get a read-only explanation. The PUT body is the full state, not a
 * patch (rest-api.md § Bindings).
 */
export function BindingsView() {
  const router = useRouter();
  const [bindings, setBindings] = useState<InboxBinding[]>([]);
  const [kbs, setKbs] = useState<KnowledgeBaseSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [newInboxId, setNewInboxId] = useState('');
  const [busyInbox, setBusyInbox] = useState<number | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.allSettled([
      apiFetch<InboxBinding[]>('/bindings'),
      apiFetch<KnowledgeBaseSummary[]>('/knowledge-bases'),
    ]).then(([bindingsResult, kbsResult]) => {
      if (cancelled) {
        return;
      }
      if (bindingsResult.status === 'fulfilled') {
        setBindings(bindingsResult.value);
        setForbidden(false);
      } else if (
        bindingsResult.reason instanceof ApiError &&
        bindingsResult.reason.status === 403
      ) {
        setForbidden(true);
      } else {
        handleError(bindingsResult.reason);
      }
      if (kbsResult.status === 'fulfilled') {
        setKbs(kbsResult.value);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [handleError]);

  function draftFor(binding: InboxBinding): Draft {
    return drafts[binding.chatwootInboxId] ?? { enabled: binding.enabled, kbIds: binding.kbIds };
  }

  function setDraft(inboxId: number, next: Draft): void {
    setDrafts((current) => ({ ...current, [inboxId]: next }));
  }

  function isDirty(binding: InboxBinding): boolean {
    const draft = draftFor(binding);
    return (
      draft.enabled !== binding.enabled ||
      draft.kbIds.length !== binding.kbIds.length ||
      draft.kbIds.some((id) => !binding.kbIds.includes(id))
    );
  }

  async function save(binding: InboxBinding): Promise<void> {
    const draft = draftFor(binding);
    setBusyInbox(binding.chatwootInboxId);
    setError(null);
    try {
      const saved = await apiFetch<InboxBinding>(`/bindings/${binding.chatwootInboxId}`, {
        method: 'PUT',
        body: JSON.stringify({ kbIds: draft.kbIds, enabled: draft.enabled }),
      });
      setBindings((rows) =>
        rows.map((row) => (row.chatwootInboxId === saved.chatwootInboxId ? saved : row)),
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[binding.chatwootInboxId];
        return next;
      });
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusyInbox(null);
    }
  }

  async function addInbox(): Promise<void> {
    const id = Number(newInboxId);
    if (!Number.isInteger(id) || id <= 0) {
      setError('Inbox id must be a positive integer');
      return;
    }
    setBusyInbox(id);
    setError(null);
    try {
      const saved = await apiFetch<InboxBinding>(`/bindings/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ kbIds: [], enabled: true }),
      });
      setBindings((rows) =>
        [...rows.filter((row) => row.chatwootInboxId !== saved.chatwootInboxId), saved].sort(
          (a, b) => a.chatwootInboxId - b.chatwootInboxId,
        ),
      );
      setNewInboxId('');
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusyInbox(null);
    }
  }

  return (
    <>
      <h1>Inbox bindings</h1>
      <p style={{ color: 'var(--legacy-muted)' }}>
        Map Chatwoot inboxes to knowledge bases and toggle the per-inbox kill switch. An inbox with
        no knowledge bases or the switch off is ignored by the bot.
      </p>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {forbidden ? (
        <p style={{ color: 'var(--legacy-muted)' }}>
          Bindings are managed by editors and admins — ask an admin for a role if you need to change
          them.
        </p>
      ) : (
        <>
          {loading ? <p style={{ color: 'var(--legacy-muted)' }}>Loading…</p> : null}
          {!loading && bindings.length === 0 ? (
            <p style={{ color: 'var(--legacy-muted)' }}>
              No bindings yet — add an inbox below once its webhook has been seen.
            </p>
          ) : null}
          {bindings.map((binding) => {
            const draft = draftFor(binding);
            const dirty = isDirty(binding);
            const busy = busyInbox === binding.chatwootInboxId;
            return (
              <div
                key={binding.chatwootInboxId}
                style={{
                  border: '1px solid var(--legacy-border)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <strong>{binding.displayName ?? `Inbox ${binding.chatwootInboxId}`}</strong>
                    <div style={{ color: 'var(--legacy-muted)', fontSize: 12 }}>
                      #{binding.chatwootInboxId} · account {binding.chatwootAccountId}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <label style={{ color: 'var(--legacy-muted)', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) =>
                          setDraft(binding.chatwootInboxId, {
                            ...draft,
                            enabled: event.target.checked,
                          })
                        }
                      />{' '}
                      Bot enabled
                    </label>
                    <button
                      type="button"
                      disabled={!dirty || busy}
                      onClick={() => void save(binding)}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 8 }}>
                  <div style={{ color: 'var(--legacy-muted)', fontSize: 12, marginBottom: 4 }}>
                    Knowledge bases
                  </div>
                  {kbs.length === 0 ? (
                    <p style={{ color: 'var(--legacy-muted)', margin: 0 }}>
                      No knowledge bases exist yet.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {kbs.map((kb) => (
                        <label key={kb.id} style={{ fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={draft.kbIds.includes(kb.id)}
                            onChange={() =>
                              setDraft(binding.chatwootInboxId, {
                                ...draft,
                                kbIds: toggleKb(draft.kbIds, kb.id),
                              })
                            }
                          />{' '}
                          {kb.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
            <input
              type="number"
              min={1}
              placeholder="Chatwoot inbox id"
              value={newInboxId}
              onChange={(event) => setNewInboxId(event.target.value)}
            />
            <button
              type="button"
              disabled={newInboxId.trim() === '' || busyInbox !== null}
              onClick={() => void addInbox()}
            >
              Add inbox
            </button>
            <span style={{ color: 'var(--legacy-muted)', fontSize: 12 }}>
              Bindings seen from webhooks appear here automatically.
            </span>
          </div>
        </>
      )}
    </>
  );
}
