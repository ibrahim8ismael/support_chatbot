'use client';

import { Alert, Button, Card, Input, Label, Spinner, Table, TextField } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuditLogList } from '@support-agent/shared';

import { describeAuditData, buildAuditQuery } from '@/lib/admin';
import {
  ANALYTICS_RANGES,
  type AnalyticsRangeId,
  formatTimestamp,
  rangeFor,
} from '@/lib/analytics';
import { ApiError, apiFetch } from '@/lib/api';

const PAGE_SIZE = 50;

/**
 * Audit log (T-304, admin only): newest-first trail of logins, KB/document
 * changes, binding/settings changes and user management. Filters mirror the
 * API contract (`userId`, exact `action`, `[from, to)`) with the shared range
 * presets; payloads render collapsed.
 */
export function AuditView() {
  const router = useRouter();
  const [rangeId, setRangeId] = useState<AnalyticsRangeId>('7d');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<AuditLogList | null>(null);
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

  const filtersRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    // Rows belong to the active filters — don't leave stale ones on screen.
    const key = `${rangeId}|${action}|${userId}|${offset}`;
    if (filtersRef.current !== '' && filtersRef.current !== key) {
      setList(null);
    }
    filtersRef.current = key;

    setLoading(true);
    setError(null);

    const { from, to } = rangeFor(rangeId);
    const parsed = buildAuditQuery({
      from,
      to,
      limit: PAGE_SIZE,
      offset,
      ...(action.trim() === '' ? {} : { action: action.trim() }),
      ...(userId.trim() === '' ? {} : { userId: userId.trim() }),
    });
    if (!parsed.ok) {
      setError(parsed.error);
      setLoading(false);
      return;
    }

    void apiFetch<AuditLogList>(`/audit-logs?${parsed.query}`)
      .then((result) => {
        if (!cancelled) {
          setList(result);
          setForbidden(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          if (cause instanceof ApiError && cause.status === 403) {
            setForbidden(true);
          } else {
            handleError(cause);
          }
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rangeId, action, userId, offset, handleError]);

  const shown = list?.items.length ?? 0;
  const total = list?.total ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight">Audit log</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Who changed what, when: logins, knowledge-base and document changes, bindings, settings
          and user management.
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
              The audit log is admin-only — ask an admin if you need access.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <>
          <Card>
            <Card.Content className="flex flex-wrap items-end gap-3">
              {ANALYTICS_RANGES.map((preset) => (
                <Button
                  key={preset.id}
                  size="sm"
                  variant={rangeId === preset.id ? 'primary' : 'ghost'}
                  onPress={() => {
                    setRangeId(preset.id);
                    setOffset(0);
                  }}
                >
                  {preset.label}
                </Button>
              ))}

              <TextField
                className="w-56"
                value={action}
                onChange={(value) => {
                  setAction(value);
                  setOffset(0);
                }}
              >
                <Label>Action</Label>
                <Input placeholder="exact, e.g. users.update" />
              </TextField>

              <TextField
                className="w-64"
                value={userId}
                onChange={(value) => {
                  setUserId(value);
                  setOffset(0);
                }}
              >
                <Label>User id</Label>
                <Input placeholder="uuid" />
              </TextField>

              {loading ? <Spinner size="sm" /> : null}
            </Card.Content>
          </Card>

          <Card>
            <Card.Content className="p-0">
              {list && list.items.length === 0 && !loading ? (
                <p className="px-4 py-10 text-center text-sm text-muted">
                  No audit rows match these filters.
                </p>
              ) : (
                <Table>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Audit log" className="min-w-[760px]">
                      <Table.Header>
                        <Table.Column isRowHeader>Time</Table.Column>
                        <Table.Column>User</Table.Column>
                        <Table.Column>Action</Table.Column>
                        <Table.Column>Entity</Table.Column>
                      </Table.Header>
                      <Table.Body items={list?.items ?? []}>
                        {(entry) => (
                          <Table.Row id={entry.id}>
                            <Table.Cell>
                              <span className="whitespace-nowrap text-sm text-muted">
                                {formatTimestamp(entry.createdAt)}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <span className="text-sm">{entry.userEmail ?? '—'}</span>
                            </Table.Cell>
                            <Table.Cell>
                              <code className="rounded bg-surface-secondary px-1.5 py-0.5 text-xs">
                                {entry.action}
                              </code>
                            </Table.Cell>
                            <Table.Cell>
                              <p className="text-sm">
                                {entry.entity}
                                {entry.entityId ? (
                                  <span className="text-muted"> · {entry.entityId}</span>
                                ) : null}
                              </p>
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-muted">
                                  {describeAuditData(entry.data)}
                                </summary>
                                <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-secondary p-2 text-xs whitespace-pre-wrap">
                                  {JSON.stringify(entry.data, null, 2)}
                                </pre>
                              </details>
                            </Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              )}
            </Card.Content>
          </Card>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              isDisabled={offset === 0 || loading}
              onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={offset + shown >= total || loading}
              onPress={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </Button>
            <span className="text-xs text-muted">
              {total === 0 ? 'No rows' : `Rows ${offset + 1}–${offset + shown} of ${total}`}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
