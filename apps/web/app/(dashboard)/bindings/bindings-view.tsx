'use client';

import { Alert, Button, Card, Checkbox, Chip, Input, Label, Spinner, Switch } from '@heroui/react';
import { Plus, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

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
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight">Inbox bindings</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Map Chatwoot inboxes to knowledge bases and toggle the per-inbox kill switch. An inbox
          with no knowledge bases or the switch off is ignored by the bot.
        </p>
      </div>

      {error ? (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {forbidden ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Read-only for your role</Alert.Title>
            <Alert.Description>
              Bindings are managed by editors and admins — ask an admin for a role if you need to
              change them.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          {bindings.length === 0 ? (
            <Card>
              <Card.Content className="flex flex-col items-center gap-1 py-12 text-center">
                <p className="text-sm font-medium">No bindings yet</p>
                <p className="text-xs text-muted">
                  Add an inbox below once its webhook has been seen.
                </p>
              </Card.Content>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {bindings.map((binding) => {
                const draft = draftFor(binding);
                const dirty = isDirty(binding);
                const busy = busyInbox === binding.chatwootInboxId;
                return (
                  <Card key={binding.chatwootInboxId}>
                    <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Card.Title className="text-base">
                          {binding.displayName ?? `Inbox ${binding.chatwootInboxId}`}
                        </Card.Title>
                        <Card.Description>
                          #{binding.chatwootInboxId} · account {binding.chatwootAccountId}
                        </Card.Description>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <Switch
                          size="sm"
                          isSelected={draft.enabled}
                          onChange={(enabled) =>
                            setDraft(binding.chatwootInboxId, { ...draft, enabled })
                          }
                        >
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                          <Switch.Content>
                            <Label>Bot enabled</Label>
                          </Switch.Content>
                        </Switch>
                        <Button
                          size="sm"
                          isDisabled={!dirty || busy}
                          isPending={busy}
                          onPress={() => void save(binding)}
                        >
                          <Save className="size-4" aria-hidden />
                          Save
                        </Button>
                      </div>
                    </Card.Header>

                    <Card.Content className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium tracking-wider text-muted uppercase">
                          Knowledge bases
                        </p>
                        {dirty ? (
                          <Chip size="sm" variant="soft" color="warning">
                            Unsaved changes
                          </Chip>
                        ) : null}
                      </div>

                      {kbs.length === 0 ? (
                        <p className="text-sm text-muted">No knowledge bases exist yet.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {kbs.map((kb) => (
                            <Checkbox
                              key={kb.id}
                              variant="secondary"
                              isSelected={draft.kbIds.includes(kb.id)}
                              onChange={() =>
                                setDraft(binding.chatwootInboxId, {
                                  ...draft,
                                  kbIds: toggleKb(draft.kbIds, kb.id),
                                })
                              }
                            >
                              <Checkbox.Content>
                                <Checkbox.Control>
                                  <Checkbox.Indicator />
                                </Checkbox.Control>
                                <span className="truncate text-sm">{kb.name}</span>
                              </Checkbox.Content>
                            </Checkbox>
                          ))}
                        </div>
                      )}
                    </Card.Content>
                  </Card>
                );
              })}
            </div>
          )}

          <Card>
            <Card.Header>
              <Card.Title className="text-base">Add an inbox</Card.Title>
              <Card.Description>
                Bindings seen from webhooks appear here automatically.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addInbox();
                }}
              >
                <Input
                  type="number"
                  min={1}
                  aria-label="Chatwoot inbox id"
                  placeholder="Chatwoot inbox id"
                  className="w-52"
                  value={newInboxId}
                  onChange={(event) => setNewInboxId(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  isDisabled={newInboxId.trim() === '' || busyInbox !== null}
                >
                  <Plus className="size-4" aria-hidden />
                  Add inbox
                </Button>
              </form>
            </Card.Content>
          </Card>
        </>
      )}
    </div>
  );
}
