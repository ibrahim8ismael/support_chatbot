'use client';

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Input,
  Label,
  Spinner,
  TextArea,
  TextField,
} from '@heroui/react';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';

import type {
  KnowledgeBaseSummary,
  SandboxCase,
  SandboxExpectedBehavior,
} from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';
import { BEHAVIOR_LABELS, splitList } from '@/lib/sandbox';

export function CasesTab({
  cases,
  kbs,
  loading,
  canDelete,
  onNew,
  onEdit,
  onToggle,
  onDuplicate,
  onDelete,
  onRun,
}: {
  cases: SandboxCase[];
  kbs: KnowledgeBaseSummary[];
  loading: boolean;
  canDelete: boolean;
  onNew: () => void;
  onEdit: (item: SandboxCase) => void;
  onToggle: (item: SandboxCase) => void;
  onDuplicate: (item: SandboxCase) => void;
  onDelete: (item: SandboxCase) => void;
  onRun: () => void;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return cases;
    }
    return cases.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.question.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );
  }, [cases, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Test cases</h3>
          <p className="text-xs text-muted">
            Each case records what a good answer looks like, so runs can score it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search cases…"
            aria-label="Search cases"
            className="h-9 w-48 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
          />
          <Button size="sm" variant="secondary" onPress={onNew}>
            <Plus className="size-4" aria-hidden />
            New case
          </Button>
          <Button size="sm" isDisabled={cases.length === 0} onPress={onRun}>
            <FlaskConical className="size-4" aria-hidden />
            Run tests
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <Card.Content className="flex flex-col items-center gap-3 py-12 text-center">
            <FlaskConical className="size-8 text-muted" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {cases.length === 0 ? 'No test cases yet' : 'No cases match your search'}
              </p>
              <p className="text-xs text-muted">
                {cases.length === 0
                  ? 'Save a question from Try it, or create one here.'
                  : 'Try a different name, question, or tag.'}
              </p>
            </div>
            {cases.length === 0 ? (
              <Button size="sm" variant="secondary" onPress={onNew}>
                <Plus className="size-4" aria-hidden />
                Create the first case
              </Button>
            ) : null}
          </Card.Content>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {filtered.map((item) => (
            <li key={item.id}>
              <Card>
                <Card.Content className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{item.question}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Chip size="sm" variant="soft" color={behaviorColor(item.expectedBehavior)}>
                        {BEHAVIOR_LABELS[item.expectedBehavior]}
                      </Chip>
                      {!item.isEnabled ? (
                        <Chip size="sm" variant="soft">
                          Disabled
                        </Chip>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{kbNames(item.kbIds, kbs)}</span>
                    {item.tags.map((tag) => (
                      <Chip key={tag} size="sm" variant="soft">
                        {tag}
                      </Chip>
                    ))}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" onPress={() => onToggle(item)}>
                      {item.isEnabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => onDuplicate(item)}>
                      Duplicate
                    </Button>
                    <Button size="sm" variant="secondary" onPress={() => onEdit(item)}>
                      Edit
                    </Button>
                    {canDelete ? (
                      <Button size="sm" variant="danger" onPress={() => onDelete(item)}>
                        <Trash2 className="size-3.5" aria-hidden />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </Card.Content>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function behaviorColor(behavior: SandboxExpectedBehavior): 'success' | 'warning' | 'default' {
  switch (behavior) {
    case 'answer':
      return 'success';
    case 'escalate':
      return 'warning';
    default:
      return 'default';
  }
}

function kbNames(kbIds: string[], kbs: KnowledgeBaseSummary[]): string {
  const names = kbIds
    .map((id) => kbs.find((kb) => kb.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(', ') : 'No knowledge base selected';
}

export function CaseForm({
  draft,
  kbs,
  onCancel,
  onSaved,
  onError,
}: {
  draft: Partial<SandboxCase>;
  kbs: KnowledgeBaseSummary[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(draft.name ?? '');
  const [question, setQuestion] = useState(draft.question ?? '');
  const [kbIds, setKbIds] = useState<string[]>(draft.kbIds ?? (kbs[0] ? [kbs[0].id] : []));
  const [expectedBehavior, setExpectedBehavior] = useState<SandboxExpectedBehavior>(
    draft.expectedBehavior ?? 'answer',
  );
  const [expectedFilenames, setExpectedFilenames] = useState(
    (draft.expectedFilenames ?? []).join('\n'),
  );
  const [requiredPhrases, setRequiredPhrases] = useState((draft.requiredPhrases ?? []).join('\n'));
  const [forbiddenPhrases, setForbiddenPhrases] = useState(
    (draft.forbiddenPhrases ?? []).join('\n'),
  );
  const [referenceAnswer, setReferenceAnswer] = useState(draft.referenceAnswer ?? '');
  const [tags, setTags] = useState((draft.tags ?? []).join(', '));
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [isEnabled, setIsEnabled] = useState(draft.isEnabled ?? true);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleKb(kbId: string): void {
    setKbIds((current) =>
      current.includes(kbId) ? current.filter((id) => id !== kbId) : [...current, kbId],
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (question.trim().length < 3) {
      setFormError('Write the question a customer would ask');
      return;
    }
    if (kbIds.length === 0) {
      setFormError('Pick at least one knowledge base');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: name.trim() || undefined,
        question: question.trim(),
        kbIds,
        expectedBehavior,
        expectedFilenames: splitList(expectedFilenames),
        requiredPhrases: splitList(requiredPhrases),
        forbiddenPhrases: splitList(forbiddenPhrases),
        referenceAnswer: referenceAnswer.trim() || null,
        tags: splitList(tags),
        notes: notes.trim() || null,
        isEnabled,
      };
      if (draft.id) {
        await apiFetch<SandboxCase>(`/sandbox/cases/${draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch<SandboxCase>('/sandbox/cases', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      await onSaved();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        onError('Your session expired — sign in again.');
      } else {
        setFormError(cause instanceof Error ? cause.message : 'Could not save the case');
      }
    } finally {
      setSaving(false);
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
        <Label>Name (optional)</Label>
        <Input placeholder="Password reset" maxLength={200} />
      </TextField>

      <TextField value={question} onChange={setQuestion} isRequired>
        <Label>Question</Label>
        <TextArea rows={3} maxLength={2_000} placeholder="How do I reset my password?" />
      </TextField>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Knowledge bases</p>
        {kbs.length === 0 ? (
          <p className="text-xs text-muted">
            No active knowledge bases. Create one under{' '}
            <Link href="/knowledge-bases" className="font-medium text-accent hover:underline">
              Knowledge bases
            </Link>
            .
          </p>
        ) : (
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
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Expected behavior</span>
        <select
          value={expectedBehavior}
          onChange={(event) => setExpectedBehavior(event.target.value as SandboxExpectedBehavior)}
          className="h-10 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-accent"
        >
          <option value="answer">Should answer</option>
          <option value="escalate">Should escalate to a human</option>
          <option value="either">Either is fine</option>
        </select>
      </label>

      <TextField value={expectedFilenames} onChange={setExpectedFilenames}>
        <Label>Expected source documents (optional)</Label>
        <TextArea rows={2} placeholder="forgot-password.md" />
      </TextField>
      <p className="-mt-2 text-xs text-muted">
        One filename per line — the retrieval check passes when one of them grounds the answer.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField value={requiredPhrases} onChange={setRequiredPhrases}>
          <Label>Required phrases (optional)</Label>
          <TextArea rows={2} placeholder="30 days" />
        </TextField>
        <TextField value={forbiddenPhrases} onChange={setForbiddenPhrases}>
          <Label>Forbidden phrases (optional)</Label>
          <TextArea rows={2} placeholder="guaranteed refund" />
        </TextField>
      </div>

      <TextField value={referenceAnswer} onChange={setReferenceAnswer}>
        <Label>Reference answer (optional)</Label>
        <TextArea
          rows={2}
          placeholder="What a correct answer should say — for the human reviewer."
        />
      </TextField>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField value={tags} onChange={setTags}>
          <Label>Tags (optional)</Label>
          <Input placeholder="billing, refunds" />
        </TextField>
        <TextField value={notes} onChange={setNotes}>
          <Label>Notes (optional)</Label>
          <Input placeholder="Why this case matters" />
        </TextField>
      </div>

      <Checkbox variant="secondary" isSelected={isEnabled} onChange={setIsEnabled}>
        <Checkbox.Content>
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <span className="text-sm">Enabled — included in runs by default</span>
        </Checkbox.Content>
      </Checkbox>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={saving}>
          {draft.id ? 'Save changes' : 'Create case'}
        </Button>
      </div>
    </form>
  );
}
