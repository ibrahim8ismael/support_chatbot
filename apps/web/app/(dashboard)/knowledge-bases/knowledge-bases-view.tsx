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
import { BookOpen, FileText, Plus, RefreshCw, Trash2, Upload, PenLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import type {
  DocumentStatus,
  KnowledgeBaseSummary,
  KnowledgeDocument,
} from '@support-agent/shared';

import { canWrite, useSessionUser } from '@/components/session';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
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
  const user = useSessionUser();
  const writable = canWrite(user?.role);
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
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState<'text' | 'file'>('text');
  const [savingText, setSavingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const draftKbId = useRef<string | null>(null);
  const textModal = useOverlayState();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const previousKbRef = useRef<string | null>(null);
  const createModal = useOverlayState();

  const selectedKb = kbs.find((kb) => kb.id === selectedKbId) ?? null;
  const totalDocuments = kbs.reduce((total, kb) => total + kb.documentCount, 0);
  const processingDocuments = kbs.reduce((total, kb) => total + kb.statusCounts.processing, 0);
  const failedDocuments = kbs.reduce((total, kb) => total + kb.statusCounts.failed, 0);

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
    let wasProcessing = false;

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
          wasProcessing = true;
          timer = window.setTimeout(() => void load(), POLL_INTERVAL_MS);
        } else if (wasProcessing) {
          wasProcessing = false;
          void loadKbs();
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
  }, [selectedKbId, refreshToken, handleError, loadKbs]);

  const refreshDocuments = useCallback((): void => {
    setRefreshToken((token) => token + 1);
  }, []);

  function openCreateModal(): void {
    draftKbId.current = null;
    setCreateError(null);
    setSourceMode('text');
    createModal.open();
  }

  async function onSaveText(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedKbId) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const content = String(form.get('content') ?? '').trim();
    if (!title || !content) {
      setTextError('Enter a title and some knowledge content.');
      return;
    }
    setSavingText(true);
    setTextError(null);
    try {
      await apiFetch(`/knowledge-bases/${selectedKbId}/documents/text`, {
        method: 'POST',
        body: JSON.stringify({ title, content }),
      });
      textModal.close();
      refreshDocuments();
      await loadKbs();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) router.push('/login');
      else setTextError(cause instanceof Error ? cause.message : 'Could not save this text');
    } finally {
      setSavingText(false);
    }
  }

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

    const content = String(form.get('content') ?? '').trim();
    const initialFile = form.get('sourceFile');
    if (sourceMode === 'text' && !content) {
      setCreateError('Write some knowledge content first.');
      return;
    }
    if (sourceMode === 'file') {
      if (!(initialFile instanceof File) || initialFile.size === 0) {
        setCreateError('Choose a file to upload.');
        return;
      }
      const problem = validateUpload(initialFile);
      if (problem) {
        setCreateError(problem);
        return;
      }
    }
    setCreating(true);
    try {
      let kbId = draftKbId.current;
      if (!kbId) {
        const created = await apiFetch<KnowledgeBaseSummary>('/knowledge-bases', {
          method: 'POST',
          body: JSON.stringify({ name, ...(description.length > 0 ? { description } : {}) }),
        });
        kbId = created.id;
        draftKbId.current = kbId;
      }
      setSelectedKbId(kbId);
      if (sourceMode === 'text') {
        await apiFetch(`/knowledge-bases/${kbId}/documents/text`, {
          method: 'POST',
          body: JSON.stringify({ title: name, content }),
        });
      } else {
        await apiUpload(`/knowledge-bases/${kbId}/documents`, initialFile as File);
      }
      draftKbId.current = null;
      formElement.reset();
      setCreateError(null);
      refreshDocuments();
      createModal.close();
      setError(null);
      await loadKbs();
    } catch (cause) {
      if (draftKbId.current) {
        await loadKbs();
      }
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
    const controller = new AbortController();
    uploadAbort.current = controller;
    try {
      await apiUpload<{ documentId: string; status: DocumentStatus }>(
        `/knowledge-bases/${selectedKbId}/documents`,
        file,
        controller.signal,
      );
      refreshDocuments();
      await loadKbs();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        // Cancelled by the user — not an error to report.
      } else if (cause instanceof ApiError && cause.status === 401) {
        router.push('/login');
      } else {
        setUploadError(cause instanceof Error ? cause.message : 'Upload failed');
      }
    } finally {
      uploadAbort.current = null;
      setUploading(false);
      input.value = '';
    }
  }

  function cancelUpload(): void {
    uploadAbort.current?.abort();
  }

  async function onReprocess(documentId: string): Promise<void> {
    setBusy(true);
    setBusyDocumentId(documentId);
    try {
      await apiFetch(`/documents/${documentId}/reprocess`, { method: 'POST' });
      refreshDocuments();
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
      setBusyDocumentId(null);
    }
  }

  async function onDeleteDocument(document: KnowledgeDocument): Promise<void> {
    if (!window.confirm(`Delete "${document.filename}" and its chunks?`)) {
      return;
    }
    setBusy(true);
    setBusyDocumentId(document.id);
    try {
      await apiFetch(`/documents/${document.id}`, { method: 'DELETE' });
      refreshDocuments();
      await loadKbs();
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(false);
      setBusyDocumentId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Knowledge"
        title="Knowledge bases"
        description="Add knowledge by writing text or uploading a document. Follow indexing status and choose ready knowledge bases in the sandbox."
        actions={
          writable ? (
            <Button
              onPress={() => {
                openCreateModal();
              }}
            >
              <Plus className="size-4" aria-hidden />
              New knowledge base
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Knowledge bases"
          value={loading ? '—' : kbs.length}
          detail="Libraries in the workspace"
        />
        <MetricCard
          label="Documents"
          value={loading ? '—' : totalDocuments}
          detail="Ready or processing"
          tone="coral"
        />
        <MetricCard
          label="Processing"
          value={loading ? '—' : processingDocuments}
          detail="Ingestion in flight"
          tone="cream"
        />
        <MetricCard
          label="Needs attention"
          value={loading ? '—' : failedDocuments}
          detail={failedDocuments > 0 ? 'Failed documents' : 'No failed ingests'}
          tone={failedDocuments > 0 ? 'peach' : 'mint'}
        />
      </div>

      {user && !writable ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Read-only for your role</Alert.Title>
            <Alert.Description>
              Viewers can browse knowledge bases and documents — uploads, edits and deletions are
              editor/admin.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {error ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Request failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col rounded-xl border border-separator bg-surface p-2">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <BookOpen className="size-4 text-muted" aria-hidden />
              <h3 className="truncate text-[13px] font-medium">All knowledge bases</h3>
            </div>
            <span className="rounded-md bg-surface-secondary px-2 py-0.5 text-[11px] text-muted">
              {kbs.length}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner />
            </div>
          ) : kbs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-surface-secondary px-4 py-10 text-center">
              <BookOpen className="size-8 text-muted" aria-hidden />
              <div className="space-y-1">
                <p className="text-sm font-medium">No knowledge bases yet</p>
                <p className="text-xs text-muted">
                  Create the first one to start uploading documents.
                </p>
              </div>
              {writable ? (
                <Button size="sm" variant="secondary" onPress={openCreateModal}>
                  <Plus className="size-4" aria-hidden />
                  Create knowledge base
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
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
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? 'border-[#e7d8bf] bg-signature-cream text-ink'
                          : 'border-transparent hover:border-separator hover:bg-surface-secondary'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${
                            active ? 'bg-signature-coral' : 'bg-border'
                          }`}
                          aria-hidden
                        />
                        <span className="truncate text-[13px] font-medium">{kb.name}</span>
                        {kb.status === 'archived' ? (
                          <Chip size="sm" variant="soft">
                            Archived
                          </Chip>
                        ) : null}
                      </span>
                      {kb.description ? (
                        <span className="mt-1.5 line-clamp-2 block pl-3.5 text-xs leading-5 text-muted">
                          {kb.description}
                        </span>
                      ) : null}
                      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-3.5 text-[11px] text-muted">
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
              <Card.Header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Card.Title className="truncate">{selectedKb.name}</Card.Title>
                    <Chip size="sm" variant="soft">
                      {selectedKb.documentCount} document
                      {selectedKb.documentCount === 1 ? '' : 's'}
                    </Chip>
                  </div>
                  <Card.Description>
                    {selectedKb.description ?? 'Add written knowledge or upload documents.'}
                  </Card.Description>
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                  <input
                    ref={fileInput}
                    type="file"
                    accept={DOCUMENT_ACCEPT}
                    className="hidden"
                    onChange={(event) => void onUpload(event)}
                    disabled={uploading}
                  />
                  {writable ? (
                    <Button
                      variant="secondary"
                      onPress={() => {
                        setTextError(null);
                        textModal.open();
                      }}
                    >
                      <PenLine className="size-4" aria-hidden />
                      Write text
                    </Button>
                  ) : null}
                  {writable ? (
                    <Button
                      variant="secondary"
                      isPending={uploading}
                      onPress={() => fileInput.current?.click()}
                    >
                      <Upload className="size-4" aria-hidden />
                      Upload file
                    </Button>
                  ) : null}
                  {uploading ? (
                    <Button variant="ghost" onPress={cancelUpload}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </Card.Header>

              <Card.Content className="flex flex-col gap-3 p-0">
                {uploadError ? (
                  <div className="px-4 pt-4">
                    <Alert status="danger" role="alert">
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
                        {writable ? (
                          <Table.Column className="text-right">Actions</Table.Column>
                        ) : null}
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
                                Write knowledge directly or upload a PDF, DOCX, TXT or MD file.
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
                                    {document.sourceType === 'text'
                                      ? document.filename.replace(/\.md$/, '')
                                      : document.filename}
                                  </span>
                                  <span className="block text-xs text-muted">
                                    {document.sourceType === 'text'
                                      ? 'Written knowledge'
                                      : 'Uploaded file'}
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
                            {writable ? (
                              <Table.Cell>
                                <div className="flex justify-end gap-1">
                                  {document.status !== 'processing' ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      isPending={busyDocumentId === document.id}
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
                                    isPending={busyDocumentId === document.id}
                                    isDisabled={busy || docsLoading}
                                    onPress={() => void onDeleteDocument(document)}
                                  >
                                    <Trash2 className="size-3.5" aria-hidden />
                                    Delete
                                  </Button>
                                </div>
                              </Table.Cell>
                            ) : null}
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

      <Modal state={textModal}>
        <Modal.Backdrop>
          <Modal.Container>
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Write knowledge</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <Form className="flex flex-col gap-4" onSubmit={onSaveText}>
                  <p className="text-sm text-muted">
                    Add written knowledge to {selectedKb?.name}. It will be indexed for the agent.
                  </p>
                  <TextField isRequired>
                    <Label>Title</Label>
                    <Input name="title" maxLength={200} placeholder="Returns policy" />
                  </TextField>
                  <TextField isRequired>
                    <Label>Knowledge content</Label>
                    <TextArea
                      name="content"
                      rows={10}
                      maxLength={200000}
                      placeholder="Write or paste your knowledge here. Markdown is supported."
                    />
                  </TextField>
                  {textError ? (
                    <Alert status="danger" role="alert">
                      <Alert.Content>
                        <Alert.Description>{textError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      isDisabled={savingText}
                      onPress={textModal.close}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" isPending={savingText}>
                      Save knowledge
                    </Button>
                  </div>
                </Form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

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

                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-2 text-sm font-medium">
                      How would you like to add knowledge?
                    </legend>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={sourceMode === 'text' ? 'primary' : 'secondary'}
                        aria-pressed={sourceMode === 'text'}
                        isDisabled={creating}
                        onPress={() => setSourceMode('text')}
                      >
                        <PenLine className="size-4" aria-hidden /> Write text
                      </Button>
                      <Button
                        type="button"
                        variant={sourceMode === 'file' ? 'primary' : 'secondary'}
                        aria-pressed={sourceMode === 'file'}
                        isDisabled={creating}
                        onPress={() => setSourceMode('file')}
                      >
                        <Upload className="size-4" aria-hidden /> Upload file
                      </Button>
                    </div>
                    {sourceMode === 'text' ? (
                      <TextField isRequired>
                        <Label>Knowledge content</Label>
                        <TextArea
                          name="content"
                          rows={8}
                          maxLength={200000}
                          placeholder="Write or paste the information the agent should know. Markdown is supported."
                        />
                      </TextField>
                    ) : (
                      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-separator bg-surface-secondary p-4">
                        <label htmlFor="initial-kb-file" className="text-sm font-medium">
                          Choose a document
                        </label>
                        <input
                          id="initial-kb-file"
                          name="sourceFile"
                          type="file"
                          accept={DOCUMENT_ACCEPT}
                          required
                          disabled={creating}
                          className="max-w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-foreground file:px-3 file:py-2 file:text-background"
                        />
                        <p className="text-xs leading-5 text-muted">
                          PDF, Markdown (.md), Word (.docx) or plain text (.txt), up to 20 MB. Files
                          are uploaded and indexed automatically.
                        </p>
                      </div>
                    )}
                  </fieldset>

                  {createError ? (
                    <Alert status="danger" role="alert">
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
