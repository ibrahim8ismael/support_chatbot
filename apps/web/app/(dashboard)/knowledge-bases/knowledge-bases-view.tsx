'use client';

import {
  Alert,
  Button,
  Card,
  Chip,
  FieldError,
  Form,
  Input,
  Label,
  Modal,
  Spinner,
  Table,
  TextArea,
  TextField,
  useOverlayState,
} from '@heroui/react';
import { BookOpen, FileText, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

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

const STATUS_COLORS: Record<DocumentStatus, 'success' | 'danger' | 'warning'> = {
  ready: 'success',
  failed: 'danger',
  processing: 'warning',
};

export function KnowledgeBasesView() {
  const router = useRouter();
  const [kbs, setKbs] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [docsLoading, setDocsLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previousKbRef = useRef<string | null>(null);
  const createModal = useOverlayState();

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
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void loadKbs();
  }, [loadKbs]);

  // Documents: load on selection, keep polling while ingestion is running.
  useEffect(() => {
    if (!selectedKbId) {
      previousKbRef.current = null;
      setDocuments([]);
      setDocsLoading(false);
      return undefined;
    }
    const kbId = selectedKbId;
    let cancelled = false;
    let timer: number | undefined;

    if (previousKbRef.current !== kbId) {
      // Never show the previous KB's table under the new selection.
      previousKbRef.current = kbId;
      setDocuments([]);
      setDocsLoading(true);
    }

    async function load(): Promise<void> {
      try {
        const list = await apiFetch<KnowledgeDocument[]>(`/knowledge-bases/${kbId}/documents`);
        if (cancelled) {
          return;
        }
        setDocuments(list);
        setDocsLoading(false);
        // One poll in flight at a time: schedule the next only after this
        // response and only while something is still processing.
        if (hasProcessing(list)) {
          timer = window.setTimeout(() => void load(), POLL_INTERVAL_MS);
        }
      } catch (cause) {
        if (!cancelled) {
          setDocsLoading(false);
          handleError(cause);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedKbId, refreshToken, handleError]);

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
      setCreateError('Give the knowledge base a name');
      return;
    }

    setCreating(true);
    try {
      const created = await apiFetch<KnowledgeBaseSummary>('/knowledge-bases', {
        method: 'POST',
        body: JSON.stringify({ name, ...(description.length > 0 ? { description } : {}) }),
      });
      formElement.reset();
      setCreateError(null);
      setSelectedKbId(created.id);
      createModal.close();
      setError(null);
      await loadKbs();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        router.push('/login');
      } else {
        setCreateError(
          cause instanceof Error ? cause.message : 'Could not create the knowledge base',
        );
      }
    } finally {
      setCreating(false);
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

    setUploading(true);
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
      setUploading(false);
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight">Knowledge bases</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Upload PDF, DOCX, TXT or MD files and follow ingestion status. Retrieval and the
            playground answer from the chunks produced here.
          </p>
        </div>
        <Button
          onPress={() => {
            setCreateError(null);
            createModal.open();
          }}
        >
          <Plus className="size-4" aria-hidden />
          New knowledge base
        </Button>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold">All knowledge bases</h3>
            <span className="text-xs text-muted">{kbs.length}</span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner />
            </div>
          ) : kbs.length === 0 ? (
            <Card>
              <Card.Content className="flex flex-col items-center gap-3 py-10 text-center">
                <BookOpen className="size-8 text-muted" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No knowledge bases yet</p>
                  <p className="text-xs text-muted">
                    Create the first one to start uploading documents.
                  </p>
                </div>
                <Button size="sm" variant="secondary" onPress={createModal.open}>
                  <Plus className="size-4" aria-hidden />
                  Create knowledge base
                </Button>
              </Card.Content>
            </Card>
          ) : (
            <ul className="flex flex-col gap-2">
              {kbs.map((kb) => {
                const active = kb.id === selectedKbId;
                return (
                  <li key={kb.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedKbId(kb.id);
                        setUploadError(null);
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                        active
                          ? 'border-accent bg-accent/5 ring-1 ring-accent'
                          : 'border-border bg-surface hover:bg-surface-secondary'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{kb.name}</span>
                        {kb.status === 'archived' ? (
                          <Chip size="sm" variant="soft">
                            Archived
                          </Chip>
                        ) : null}
                      </span>
                      {kb.description ? (
                        <span className="mt-1 line-clamp-2 block text-xs text-muted">
                          {kb.description}
                        </span>
                      ) : null}
                      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                        <span>
                          {kb.documentCount} document{kb.documentCount === 1 ? '' : 's'}
                        </span>
                        {kb.statusCounts.processing > 0 ? (
                          <span className="text-warning">
                            {kb.statusCounts.processing} processing
                          </span>
                        ) : null}
                        {kb.statusCounts.failed > 0 ? (
                          <span className="text-danger">{kb.statusCounts.failed} failed</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="min-w-0">
          {!selectedKb ? (
            <Card className="h-full">
              <Card.Content className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
                <FileText className="size-8 text-muted" aria-hidden />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Select a knowledge base</p>
                  <p className="text-xs text-muted">
                    Its documents and ingestion status appear here.
                  </p>
                </div>
              </Card.Content>
            </Card>
          ) : (
            <Card>
              <Card.Header className="flex flex-row items-start justify-between gap-4">
                <div className="min-w-0">
                  <Card.Title className="truncate">{selectedKb.name}</Card.Title>
                  <Card.Description className="truncate">
                    {selectedKb.description ?? 'No description'}
                  </Card.Description>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept={DOCUMENT_ACCEPT}
                  className="hidden"
                  onChange={(event) => void onUpload(event)}
                  disabled={uploading}
                />
                <Button
                  variant="secondary"
                  isPending={uploading}
                  onPress={() => fileInput.current?.click()}
                >
                  <Upload className="size-4" aria-hidden />
                  Upload document
                </Button>
              </Card.Header>

              <Card.Content className="flex flex-col gap-3 p-0">
                {uploadError ? (
                  <div className="px-4 pt-4">
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Description>{uploadError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  </div>
                ) : null}

                <Table>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Documents" className="min-w-[640px]">
                      <Table.Header>
                        <Table.Column isRowHeader>File</Table.Column>
                        <Table.Column>Status</Table.Column>
                        <Table.Column>Size</Table.Column>
                        <Table.Column>Chunks</Table.Column>
                        <Table.Column className="text-right">Actions</Table.Column>
                      </Table.Header>
                      <Table.Body
                        items={documents}
                        renderEmptyState={() =>
                          docsLoading ? (
                            <div className="flex justify-center py-12">
                              <Spinner />
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1 py-12 text-center">
                              <p className="text-sm font-medium">No documents yet</p>
                              <p className="text-xs text-muted">
                                Upload a PDF, DOCX, TXT or MD file to ingest it.
                              </p>
                            </div>
                          )
                        }
                      >
                        {(document) => (
                          <Table.Row id={document.id}>
                            <Table.Cell>
                              <span className="flex min-w-0 items-center gap-2">
                                <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">
                                    {document.filename}
                                  </span>
                                  {document.error ? (
                                    <span className="block truncate text-xs text-danger">
                                      {document.error}
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <Chip size="sm" variant="soft" color={STATUS_COLORS[document.status]}>
                                {DOCUMENT_STATUS_LABELS[document.status]}
                              </Chip>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-sm text-muted">
                                {formatBytes(document.sizeBytes)}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-sm text-muted">
                                {document.status === 'ready' ? document.chunkCount : '—'}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="flex justify-end gap-1">
                                {document.status !== 'processing' ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    isDisabled={busy || docsLoading}
                                    onPress={() => void onReprocess(document.id)}
                                  >
                                    <RefreshCw className="size-3.5" aria-hidden />
                                    Reprocess
                                  </Button>
                                ) : null}
                                <Button
                                  size="sm"
                                  variant="danger"
                                  isDisabled={busy || docsLoading}
                                  onPress={() => void onDeleteDocument(document)}
                                >
                                  <Trash2 className="size-3.5" aria-hidden />
                                  Delete
                                </Button>
                              </div>
                            </Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </Card.Content>
            </Card>
          )}
        </section>
      </div>

      <Modal state={createModal}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>New knowledge base</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <Form className="flex flex-col gap-4" onSubmit={onCreate}>
                  <TextField isRequired>
                    <Label>Name</Label>
                    <Input name="name" maxLength={200} placeholder="Product documentation" />
                    <FieldError />
                  </TextField>

                  <TextField>
                    <Label>
                      Description <span className="text-muted">(optional)</span>
                    </Label>
                    <TextArea
                      name="description"
                      rows={3}
                      maxLength={2000}
                      placeholder="What does this knowledge base cover?"
                    />
                  </TextField>

                  {createError ? (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Description>{createError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  ) : null}

                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onPress={createModal.close}>
                      Cancel
                    </Button>
                    <Button type="submit" isPending={creating}>
                      Create knowledge base
                    </Button>
                  </div>
                </Form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
