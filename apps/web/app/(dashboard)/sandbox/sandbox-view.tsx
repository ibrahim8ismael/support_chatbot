'use client';

import { Alert, Modal, useOverlayState } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type {
  KnowledgeBaseSummary,
  SandboxCase,
  SandboxResult,
  SandboxRun,
} from '@support-agent/shared';

import { canWrite, useSessionUser } from '@/components/session';
import { ApiError, apiFetch } from '@/lib/api';
import { resultsToCsv } from '@/lib/sandbox';

import { PlaygroundView } from '../playground/playground-view';
import { CaseForm, CasesTab } from './cases-tab';
import { RunForm } from './run-form';
import { RunsTab } from './runs-tab';

type Tab = 'try' | 'cases' | 'runs';

/** Poll cadence while a run is queued or executing. */
const RUN_POLL_MS = 2_500;

export function SandboxView() {
  const router = useRouter();
  const user = useSessionUser();
  const canManage = canWrite(user?.role);
  const canDelete = user?.role === 'admin';

  const [tab, setTab] = useState<Tab>('try');
  const [kbs, setKbs] = useState<KnowledgeBaseSummary[]>([]);
  const [cases, setCases] = useState<SandboxCase[]>([]);
  const [runs, setRuns] = useState<SandboxRun[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [caseDraft, setCaseDraft] = useState<Partial<SandboxCase> | null>(null);
  const [caseVersion, setCaseVersion] = useState(0);
  const [runDraftOpen, setRunDraftOpen] = useState(false);
  const [runVersion, setRunVersion] = useState(0);
  const caseModal = useOverlayState();
  const runModal = useOverlayState();

  const [selectedRun, setSelectedRun] = useState<SandboxRun | null>(null);
  const [results, setResults] = useState<SandboxResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  /** Ignore a slow result fetch after the user selected a different run. */
  const resultsRequest = useRef(0);

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

  const loadKbs = useCallback(async (): Promise<void> => {
    try {
      const list = await apiFetch<KnowledgeBaseSummary[]>('/knowledge-bases');
      setKbs(list);
      setError(null);
    } catch (cause) {
      handleError(cause);
    }
  }, [handleError]);

  const loadCases = useCallback(async (): Promise<void> => {
    setCasesLoading(true);
    try {
      const list = await apiFetch<SandboxCase[]>('/sandbox/cases');
      setCases(list);
    } catch (cause) {
      handleError(cause);
    } finally {
      setCasesLoading(false);
    }
  }, [handleError]);

  const loadRuns = useCallback(async (): Promise<void> => {
    try {
      const list = await apiFetch<SandboxRun[]>('/sandbox/runs');
      setRuns(list);
    } catch (cause) {
      handleError(cause);
    }
  }, [handleError]);

  useEffect(() => {
    void loadKbs();
  }, [loadKbs]);

  useEffect(() => {
    if (!canManage) {
      return;
    }
    void loadCases();
    void loadRuns();
  }, [canManage, loadCases, loadRuns]);

  const openRun = useCallback(
    async (run: SandboxRun): Promise<void> => {
      const request = resultsRequest.current + 1;
      resultsRequest.current = request;
      setSelectedRun(run);
      setTab('runs');
      setResultsLoading(true);
      try {
        const list = await apiFetch<SandboxResult[]>(`/sandbox/runs/${run.id}/results`);
        if (request !== resultsRequest.current) {
          return;
        }
        setResults(list);
        setError(null);
      } catch (cause) {
        if (request === resultsRequest.current) {
          handleError(cause);
        }
      } finally {
        if (request === resultsRequest.current) {
          setResultsLoading(false);
        }
      }
    },
    [handleError],
  );

  // Poll the selected run while it is queued/running.
  useEffect(() => {
    if (!selectedRun) {
      return undefined;
    }
    if (selectedRun.status !== 'queued' && selectedRun.status !== 'running') {
      return undefined;
    }
    const runId = selectedRun.id;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const [run, list] = await Promise.all([
            apiFetch<SandboxRun>(`/sandbox/runs/${runId}`),
            apiFetch<SandboxResult[]>(`/sandbox/runs/${runId}/results`),
          ]);
          if (cancelled) {
            return;
          }
          setSelectedRun(run);
          setResults(list);
          setRuns((current) => current.map((item) => (item.id === run.id ? run : item)));
        } catch {
          // The next tick retries; a transient poll failure must not clear the view.
        }
      })();
    }, RUN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedRun?.id, selectedRun?.status]);

  function saveCaseFromExchange(
    question: string,
    answer: { answer: string; escalated: boolean; chunks: Array<{ document: string }> },
    kbIds: string[],
  ): void {
    openCaseDraft({
      name: question.slice(0, 120),
      question,
      kbIds,
      expectedBehavior: answer.escalated ? 'escalate' : 'answer',
      expectedFilenames: [...new Set(answer.chunks.map((chunk) => chunk.document))],
      referenceAnswer: answer.escalated ? null : answer.answer,
      notes: 'Created from a Try it exchange.',
    });
  }

  function openCaseDraft(draft: Partial<SandboxCase>): void {
    setCaseDraft(draft);
    setCaseVersion((version) => version + 1);
    caseModal.open();
  }

  function newCase(): void {
    openCaseDraft({ expectedBehavior: 'answer' });
  }

  function editCase(item: SandboxCase): void {
    openCaseDraft(item);
  }

  function openRunForm(): void {
    setRunDraftOpen(true);
    setRunVersion((version) => version + 1);
    runModal.open();
  }

  async function toggleCase(item: SandboxCase): Promise<void> {
    try {
      await apiFetch<SandboxCase>(`/sandbox/cases/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isEnabled: !item.isEnabled }),
      });
      await loadCases();
    } catch (cause) {
      handleError(cause);
    }
  }

  async function duplicateCase(item: SandboxCase): Promise<void> {
    try {
      await apiFetch<SandboxCase>('/sandbox/cases', {
        method: 'POST',
        body: JSON.stringify({
          name: `${item.name} (copy)`,
          question: item.question,
          kbIds: item.kbIds,
          history: item.history,
          expectedBehavior: item.expectedBehavior,
          expectedFilenames: item.expectedFilenames,
          requiredPhrases: item.requiredPhrases,
          forbiddenPhrases: item.forbiddenPhrases,
          referenceAnswer: item.referenceAnswer,
          tags: item.tags,
          notes: item.notes,
          isEnabled: item.isEnabled,
        }),
      });
      await loadCases();
    } catch (cause) {
      handleError(cause);
    }
  }

  async function deleteCase(item: SandboxCase): Promise<void> {
    if (!window.confirm(`Delete the test case "${item.name}"?`)) {
      return;
    }
    try {
      await apiFetch(`/sandbox/cases/${item.id}`, { method: 'DELETE' });
      await loadCases();
    } catch (cause) {
      handleError(cause);
    }
  }

  async function reviewResult(
    result: SandboxResult,
    status: 'pass' | 'fail' | 'unreviewed',
  ): Promise<void> {
    try {
      const updated = await apiFetch<SandboxResult>(`/sandbox/results/${result.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setResults((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (selectedRun?.id === result.runId) {
        const run = await apiFetch<SandboxRun>(`/sandbox/runs/${selectedRun.id}`);
        setSelectedRun(run);
        setRuns((current) => current.map((item) => (item.id === run.id ? run : item)));
      }
    } catch (cause) {
      handleError(cause);
    }
  }

  async function cancelRun(run: SandboxRun): Promise<void> {
    try {
      const updated = await apiFetch<SandboxRun>(`/sandbox/runs/${run.id}/cancel`, {
        method: 'POST',
      });
      setRuns((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await openRun(updated);
    } catch (cause) {
      handleError(cause);
    }
  }

  async function retryRun(run: SandboxRun): Promise<void> {
    try {
      const updated = await apiFetch<SandboxRun>(`/sandbox/runs/${run.id}/retry-failed`, {
        method: 'POST',
      });
      setSelectedRun(updated);
      setRuns((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      await openRun(updated);
    } catch (cause) {
      handleError(cause);
    }
  }

  function exportRun(): void {
    if (!selectedRun) {
      return;
    }
    const blob = new Blob([resultsToCsv(results)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sandbox-run-${selectedRun.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function onRunCreated(run: SandboxRun): Promise<void> {
    runModal.close();
    setRunDraftOpen(false);
    await loadRuns();
    await openRun(run);
  }

  const activeKbs = kbs.filter((kb) => kb.status === 'active');

  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight">Sandbox</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Test the knowledge bases and the agent against saved questions. Runs use the real answer
          path — nothing is ever sent to customers or saved to analytics.
        </p>
      </div>

      {error ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div
        role="tablist"
        aria-label="Sandbox sections"
        className="flex w-fit flex-wrap gap-1 rounded-2xl border border-border bg-surface p-1"
      >
        <TabButton tab="try" current={tab} onSelect={setTab}>
          Try it
        </TabButton>
        {canManage ? (
          <>
            <TabButton tab="cases" current={tab} onSelect={setTab}>
              Test cases {cases.length > 0 ? `(${cases.length})` : ''}
            </TabButton>
            <TabButton tab="runs" current={tab} onSelect={setTab}>
              Runs {runs.length > 0 ? `(${runs.length})` : ''}
            </TabButton>
          </>
        ) : null}
      </div>

      {tab === 'try' ? (
        <PlaygroundView onSaveCase={canManage ? saveCaseFromExchange : undefined} />
      ) : null}

      {tab === 'cases' && canManage ? (
        <CasesTab
          cases={cases}
          kbs={kbs}
          loading={casesLoading}
          canDelete={canDelete}
          onNew={newCase}
          onEdit={editCase}
          onToggle={(item) => void toggleCase(item)}
          onDuplicate={(item) => void duplicateCase(item)}
          onDelete={(item) => void deleteCase(item)}
          onRun={openRunForm}
        />
      ) : null}

      {tab === 'runs' && canManage ? (
        <RunsTab
          runs={runs}
          selectedRun={selectedRun}
          results={results}
          resultsLoading={resultsLoading}
          onSelect={(run) => void openRun(run)}
          onNew={openRunForm}
          onCancel={(run) => void cancelRun(run)}
          onRetry={(run) => void retryRun(run)}
          onReview={(result, status) => void reviewResult(result, status)}
          onExport={exportRun}
        />
      ) : null}

      <Modal state={caseModal}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="max-w-2xl">
              <Modal.Header>
                <Modal.Heading>{caseDraft?.id ? 'Edit test case' : 'New test case'}</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {caseDraft ? (
                  <CaseForm
                    key={`${caseDraft.id ?? 'new'}:${caseVersion}`}
                    draft={caseDraft}
                    kbs={activeKbs}
                    onCancel={() => caseModal.close()}
                    onSaved={async () => {
                      caseModal.close();
                      setTab('cases');
                      await loadCases();
                    }}
                    onError={setError}
                  />
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal state={runModal}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog className="max-w-2xl">
              <Modal.Header>
                <Modal.Heading>New run</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {runDraftOpen ? (
                  <RunForm
                    key={runVersion}
                    kbs={activeKbs}
                    cases={cases}
                    onCancel={() => {
                      runModal.close();
                      setRunDraftOpen(false);
                    }}
                    onCreated={(run) => void onRunCreated(run)}
                    onError={setError}
                  />
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  children,
}: {
  tab: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  children: ReactNode;
}) {
  const active = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab)}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'bg-accent/10 text-accent'
          : 'text-muted hover:bg-surface-secondary hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
