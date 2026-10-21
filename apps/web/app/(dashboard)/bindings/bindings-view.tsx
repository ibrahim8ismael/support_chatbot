'use client';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Input,
  Label,
  ListBox,
  Select,
  Spinner,
  Switch,
} from '@heroui/react';
import { Plus, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { InboxBinding, KnowledgeBaseSummary } from '@support-agent/shared';

import { PageHeader } from '@/components/ui/page-header';
import { ApiError, apiFetch } from '@/lib/api';

interface Draft {
  enabled: boolean;
  kbIds: string[];
}

interface ChatwootInboxOption {
  id: number;
  name: string;
  channelType: string | null;
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
  const [chatwootInboxes, setChatwootInboxes] = useState<ChatwootInboxOption[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [newInboxId, setNewInboxId] = useState('');
  const [busyInbox, setBusyInbox] = useState<number | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
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
      apiFetch<ChatwootInboxOption[]>('/bindings/chatwoot-inboxes'),
    ]).then(([bindingsResult, kbsResult, inboxesResult]) => {
      if (cancelled) {
        return;
      }
      if (bindingsResult.status === 'fulfilled') {
        setBindings(bindingsResult.value);
        setForbidden(false);
        setLoadFailed(false);
      } else if (
        bindingsResult.reason instanceof ApiError &&
        bindingsResult.reason.status === 403
      ) {
        setForbidden(true);
      } else {
        setLoadFailed(true);
        handleError(bindingsResult.reason);
      }
      if (kbsResult.status === 'fulfilled') {
        setKbs(kbsResult.value);
      }
      if (inboxesResult.status === 'fulfilled') {
        setChatwootInboxes(inboxesResult.value);
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

  function applySaved(saved: InboxBinding): void {
    setBindings((rows) =>
      rows.map((row) => (row.chatwootInboxId === saved.chatwootInboxId ? saved : row)),
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[saved.chatwootInboxId];
      return next;
    });
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
      applySaved(saved);
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusyInbox(null);
    }
  }

  /**
   * The kill switch is an emergency control: it saves the moment it flips (with
   * the current draft KB selection) instead of waiting for the Save button, and
   * snaps back to the server state when the write fails.
   */
  async function toggleEnabled(binding: InboxBinding, enabled: boolean): Promise<void> {
    const draft = { ...draftFor(binding), enabled };
    setBusyInbox(binding.chatwootInboxId);
    setError(null);
    try {
      const saved = await apiFetch<InboxBinding>(`/bindings/${binding.chatwootInboxId}`, {
        method: 'PUT',
        body: JSON.stringify({ kbIds: draft.kbIds, enabled }),
      });
      applySaved(saved);
    } catch (cause) {
      setDrafts((current) => {
        const next = { ...current };
        next[binding.chatwootInboxId] = {
          enabled: binding.enabled,
          kbIds: current[binding.chatwootInboxId]?.kbIds ?? binding.kbIds,
        };
        return next;
      });
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
    if (bindings.some((binding) => binding.chatwootInboxId === id)) {
      setError(`Inbox #${id} is already in the list — edit it there instead of re-adding it.`);
      return;
    }
    if (loadFailed) {
      setError('The binding list failed to load — reload the page before adding an inbox.');
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
      <PageHeader
        eyebrow="Operations"
        title="Inbox bindings"
        description="Map Chatwoot inboxes to knowledge bases and toggle the per-inbox kill switch. An inbox with no knowledge bases or the switch off is ignored by the bot."
      />

      {error ? (
        <Alert status="danger" role="alert">
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
                  Add an inbox below after configuring its Agent Bot.
                </p>
              </Card.Content>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {bindings.map((binding) => {
                const draft = draftFor(binding);
                const dirty = isDirty(binding);
                const busy = busyInbox === binding.chatwootInboxId;
                return (
                  <Card key={binding.chatwootInboxId}>
                    <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Card.Title className="text-base">
                            {binding.displayName ??
                              chatwootInboxes.find((inbox) => inbox.id === binding.chatwootInboxId)
                                ?.name ??
                              `Inbox ${binding.chatwootInboxId}`}
                          </Card.Title>
                          <Chip
                            size="sm"
                            variant="soft"
                            color={draft.enabled ? 'success' : 'default'}
                          >
                            {draft.enabled ? 'Enabled' : 'Disabled'}
                          </Chip>
                        </div>
                        <Card.Description>
                          #{binding.chatwootInboxId} · account {binding.chatwootAccountId}
                        </Card.Description>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                        <Switch
                          size="sm"
                          isSelected={draft.enabled}
                          isDisabled={busy}
                          onChange={(enabled) => void toggleEnabled(binding, enabled)}
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
                              isDisabled={busy}
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
                {chatwootInboxes.length > 0
                  ? 'Choose an inbox from your Chatwoot account.'
                  : 'Inbox discovery needs CHATWOOT_ACCOUNT_API_TOKEN; you can still enter an inbox ID manually.'}
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
                {chatwootInboxes.length > 0 ? (
                  <Select
                    aria-label="Chatwoot inbox"
                    className="w-72"
                    value={newInboxId}
                    onChange={(value) => setNewInboxId(typeof value === 'string' ? value : '')}
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {chatwootInboxes
                          .filter(
                            (inbox) =>
                              !bindings.some((binding) => binding.chatwootInboxId === inbox.id),
                          )
                          .map((inbox) => (
                            <ListBox.Item
                              key={inbox.id}
                              id={String(inbox.id)}
                              textValue={`${inbox.name} (${inbox.id})`}
                            >
                              {inbox.name} · #{inbox.id}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                ) : (
                  <Input
                    type="number"
                    min={1}
                    aria-label="Chatwoot inbox id"
                    placeholder="Chatwoot inbox id"
                    className="w-52"
                    value={newInboxId}
                    onChange={(event) => setNewInboxId(event.target.value)}
                  />
                )}
                <Button
                  type="submit"
                  variant="secondary"
                  isPending={busyInbox !== null && Number(newInboxId) === busyInbox}
                  isDisabled={newInboxId.trim() === '' || busyInbox !== null || loadFailed}
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
