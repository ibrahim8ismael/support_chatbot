'use client';

import { Alert, Button, Checkbox, Input, Label, TextField } from '@heroui/react';
import { FlaskConical } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import type { KnowledgeBaseSummary, SandboxCase, SandboxRun } from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';

export function RunForm({
  kbs,
  cases,
  onCancel,
  onCreated,
  onError,
}: {
  kbs: KnowledgeBaseSummary[];
  cases: SandboxCase[];
  onCancel: () => void;
  onCreated: (run: SandboxRun) => void;
  onError: (message: string) => void;
}) {
  const enabledCases = useMemo(() => cases.filter((item) => item.isEnabled), [cases]);
  const [name, setName] = useState('');
  const [caseIds, setCaseIds] = useState<string[]>(enabledCases.map((item) => item.id));
  const [kbIds, setKbIds] = useState<string[]>(() => defaultKbIds(enabledCases, kbs));
  const [formError, setFormError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  function toggleCase(id: string): void {
    setCaseIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleKb(id: string): void {
    setKbIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (caseIds.length === 0) {
      setFormError('Select at least one test case');
      return;
    }
    if (kbIds.length === 0) {
      setFormError('Select at least one knowledge base');
      return;
    }

    setStarting(true);
    setFormError(null);
    try {
      const run = await apiFetch<SandboxRun>('/sandbox/runs', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim() || undefined,
          kbIds,
          caseIds,
        }),
      });
      onCreated(run);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onError('Your session expired — sign in again.');
      } else {
        setFormError(cause instanceof Error ? cause.message : 'Could not start the run');
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {formError ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{formError}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <TextField value={name} onChange={setName}>
        <Label>Run name (optional)</Label>
        <Input placeholder="After the refund policy update" maxLength={200} />
      </TextField>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Test cases</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onPress={() => setCaseIds(enabledCases.map((item) => item.id))}
            >
              Select enabled
            </Button>
            <Button type="button" size="sm" variant="ghost" onPress={() => setCaseIds([])}>
              Clear
            </Button>
          </div>
        </div>
        {cases.length === 0 ? (
          <p className="text-xs text-muted">No test cases yet — create one first.</p>
        ) : (
          <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-xl border border-border p-3">
            {cases.map((item) => (
              <Checkbox
                key={item.id}
                variant="secondary"
                isSelected={caseIds.includes(item.id)}
                onChange={() => toggleCase(item.id)}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">
                      {item.name}
                      {item.isEnabled ? '' : ' (disabled)'}
                    </span>
                    <span className="truncate text-xs text-muted">{item.question}</span>
                  </span>
                </Checkbox.Content>
              </Checkbox>
            ))}
          </div>
        )}
        <p className="text-xs text-muted">{caseIds.length} case(s) selected</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Knowledge bases</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {kbs.map((kb) => (
            <Checkbox
              key={kb.id}
              variant="secondary"
              isSelected={kbIds.includes(kb.id)}
              onChange={() => toggleKb(kb.id)}
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
      </div>

      <p className="text-xs text-muted">
        Runs use real model calls and are capped at 100 cases and 10 runs per day. The run keeps
        going in the background — you can leave this page.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={starting} isDisabled={cases.length === 0}>
          <FlaskConical className="size-4" aria-hidden />
          Start run
        </Button>
      </div>
    </form>
  );
}

function defaultKbIds(cases: SandboxCase[], kbs: KnowledgeBaseSummary[]): string[] {
  const active = new Set(kbs.map((kb) => kb.id));
  const fromCases = [...new Set(cases.flatMap((item) => item.kbIds))].filter((id) =>
    active.has(id),
  );
  if (fromCases.length > 0) {
    return fromCases.slice(0, 10);
  }
  return kbs.slice(0, 1).map((kb) => kb.id);
}
