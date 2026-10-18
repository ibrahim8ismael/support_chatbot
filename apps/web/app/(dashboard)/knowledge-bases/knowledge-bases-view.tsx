'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

import type {
  DocumentStatus,
  KnowledgeBaseSummary,
  KnowledgeDocument,
} from '@support-agent/shared';

import { ApiError, apiFetch, apiUpload } from '@/lib/api';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_STATUS_LABELS,
  formatBytes,
  hasProcessing,
  validateUpload,
} from '@/lib/documents';

/** Ingestion runs in the BullMQ worker — poll while anything is processing. */
const POLL_INTERVAL_MS = 2500;

export function KnowledgeBasesView() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedKb = kbs.find((kb) => kb.id === selectedKbId) ?? null;

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

  useEffect(() => {
    void loadKbs();
  }, [loadKbs]);

  // Documents: load on selection, keep polling while ingestion is running.
  const polling = hasProcessing(documents);
  useEffect(() => {
    if (!selectedKbId) {
      setDocuments([]);
      return undefined;
    }
    const kbId = selectedKbId;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const list = await apiFetch<KnowledgeDocument[]>(`/knowledge-bases/${kbId}/documents`);
        if (!cancelled) {
          setDocuments(list);
        }
      } catch (cause) {
        if (!cancelled) {
          handleError(cause);
        }
      }
    }
    void load();
    if (!polling) {
      return undefined;
    }
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedKbId, polling, refreshToken, handleError]);

  const refreshDocuments = useCallback((): void => {
    setRefreshToken((token) => token + 1);
  }, []);

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get('name') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    if (name.length === 0) {
      setError('Give the knowledge base a name');
      return;
    }

    setBusy(true);
    try {
      const created = await apiFetch<KnowledgeBaseSummary>('/knowledge-bases', {
        method: 'POST',
        body: JSON.stringify({ name, ...(description.length > 0 ? { description } : {}) }),
      });
      formElement.reset();
      setSelectedKbId(created.id);
      setError(null);
      await loadKbs();
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !selectedKbId) {
      return;
    }

    const problem = validateUpload(file);
    if (problem) {
      setUploadError(problem);
      input.value = '';
      return;
    }

    setBusy(true);
    setUploadError(null);
    try {
      await apiUpload<{ documentId: string; status: DocumentStatus }>(
        `/knowledge-bases/${selectedKbId}/documents`,
        file,
      );
      refreshDocuments();
      await loadKbs();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.push('/login');
      } else {
        setUploadError(cause instanceof Error ? cause.message : 'Upload failed');
      }
    } finally {
      setBusy(false);
      input.value = '';
    }
  }

  async function onReprocess(documentId: string): Promise<void> {
    setBusy(true);
    try {
      await apiFetch(`/documents/${documentId}/reprocess`, { method: 'POST' });
      refreshDocuments();
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteDocument(document: KnowledgeDocument): Promise<void> {
    if (!window.confirm(`Delete "${document.filename}" and its chunks?`)) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/documents/${document.id}`, { method: 'DELETE' });
      refreshDocuments();
      await loadKbs();
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Knowledge bases</h1>
      <p style={{ color: 'var(--legacy-muted)' }}>
        Upload PDF/DOCX/TXT/MD files and follow ingestion status. Retrieval and the playground
        answer from the chunks produced here.
      </p>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      <section
        style={{
          display: 'grid',
          gap: 24,
          gridTemplateColumns: 'minmax(260px, 360px) 1fr',
          marginTop: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 16 }}>Create</h2>
          <form
            onSubmit={onCreate}
            style={{
              display: 'grid',
              gap: 8,
              border: '1px solid var(--legacy-border)',
              padding: 12,
            }}
          >
            <label>
              Name
              <input name="name" required maxLength={200} style={{ width: '100%' }} />
            </label>
            <label>
              Description
              <textarea name="description" rows={2} maxLength={2000} style={{ width: '100%' }} />
            </label>
            <button type="submit" disabled={busy}>
              Create knowledge base
            </button>
          </form>

          <h2 style={{ fontSize: 16, marginTop: 24 }}>All knowledge bases</h2>
          {kbs.length === 0 ? (
            <p style={{ color: 'var(--legacy-muted)' }}>
              No knowledge bases yet — create the first one.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {kbs.map((kb) => (
                <li key={kb.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedKbId(kb.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: 10,
                      cursor: 'pointer',
                      background: 'transparent',
                      border:
                        kb.id === selectedKbId
                          ? '2px solid #2563eb'
                          : '1px solid var(--legacy-border)',
                    }}
                  >
                    <strong>{kb.name}</strong>
                    {kb.status === 'archived' ? <em> · archived</em> : null}
                    <div style={{ color: 'var(--legacy-muted)', fontSize: 13 }}>
                      {kb.documentCount} document{kb.documentCount === 1 ? '' : 's'}
                      {kb.statusCounts.processing > 0
                        ? ` · ${kb.statusCounts.processing} processing`
                        : ''}
                      {kb.statusCounts.failed > 0 ? ` · ${kb.statusCounts.failed} failed` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 style={{ fontSize: 16 }}>
            {selectedKb ? `Documents — ${selectedKb.name}` : 'Documents'}
          </h2>
          {!selectedKb ? (
            <p style={{ color: 'var(--legacy-muted)' }}>
              Select a knowledge base to manage its documents.
            </p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                <input
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  onChange={(event) => void onUpload(event)}
                  disabled={busy}
                />
                {uploadError ? <p style={{ color: 'crimson', margin: 0 }}>{uploadError}</p> : null}
              </div>
              {documents.length === 0 ? (
                <p style={{ color: 'var(--legacy-muted)' }}>No documents yet — upload one above.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                  {documents.map((document) => (
                    <li
                      key={document.id}
                      style={{
                        border: '1px solid var(--legacy-border)',
                        padding: 10,
                        display: 'grid',
                        gap: 4,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: 8,
                        }}
                      >
                        <strong>{document.filename}</strong>
                        <span style={{ color: statusColor(document.status) }}>
                          {DOCUMENT_STATUS_LABELS[document.status]}
                        </span>
                      </div>
                      <div style={{ color: 'var(--legacy-muted)', fontSize: 13 }}>
                        {formatBytes(document.sizeBytes)}
                        {document.status === 'ready'
                          ? ` · ${document.chunkCount} chunk${document.chunkCount === 1 ? '' : 's'}`
                          : ''}
                      </div>
                      {document.error ? (
                        <p style={{ color: 'crimson', margin: 0, fontSize: 13 }}>
                          {document.error}
                        </p>
                      ) : null}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {document.status !== 'processing' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onReprocess(document.id)}
                          >
                            Reprocess
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onDeleteDocument(document)}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

function statusColor(status: DocumentStatus): string {
  switch (status) {
    case 'ready':
      return '#15803d';
    case 'failed':
      return 'crimson';
    default:
      return 'var(--legacy-muted)';
  }
}
