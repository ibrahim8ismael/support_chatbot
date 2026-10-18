'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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

  useEffect(() => {
    let cancelled = false;
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
    <>
      <h1>Audit log</h1>
      <p style={{ color: 'var(--muted)' }}>
        Who changed what, when: logins, knowledge-base and document changes, bindings, settings and
        user management.
      </p>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}

      {forbidden ? (
        <p style={{ color: 'var(--muted)' }}>The audit log is admin-only.</p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              margin: '12px 0',
            }}
          >
            {ANALYTICS_RANGES.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={rangeId === preset.id}
                onClick={() => {
                  setRangeId(preset.id);
                  setOffset(0);
                }}
                style={{
                  padding: '4px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  background: rangeId === preset.id ? '#2563eb' : 'transparent',
                  color: rangeId === preset.id ? 'white' : 'inherit',
                  cursor: 'pointer',
                }}
              >
                {preset.label}
              </button>
            ))}
            <label style={{ color: 'var(--muted)' }}>
              Action{' '}
              <input
                placeholder="exact, e.g. users.update"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label style={{ color: 'var(--muted)' }}>
              User id{' '}
              <input
                placeholder="uuid"
                value={userId}
                onChange={(event) => {
                  setUserId(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
            {loading ? <span style={{ color: 'var(--muted)' }}>Loading…</span> : null}
          </div>

          {list && list.items.length === 0 && !loading ? (
            <p style={{ color: 'var(--muted)' }}>No audit rows match these filters.</p>
          ) : null}

          {list && list.items.length > 0 ? (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>Time</th>
                  <th style={{ padding: '4px 8px' }}>User</th>
                  <th style={{ padding: '4px 8px' }}>Action</th>
                  <th style={{ padding: '4px 0 4px 8px' }}>Entity</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px 6px 0', whiteSpace: 'nowrap' }}>
                      {formatTimestamp(entry.createdAt)}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{entry.userEmail ?? '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <code>{entry.action}</code>
                    </td>
                    <td style={{ padding: '6px 0 6px 8px' }}>
                      <div>
                        {entry.entity}
                        {entry.entityId ? (
                          <span style={{ color: 'var(--muted)' }}> · {entry.entityId}</span>
                        ) : null}
                      </div>
                      <details style={{ marginTop: 2 }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>
                          {describeAuditData(entry.data)}
                        </summary>
                        <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>
                          {JSON.stringify(entry.data, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={offset + shown >= total || loading}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
              {total === 0 ? 'No rows' : `Rows ${offset + 1}–${offset + shown} of ${total}`}
            </span>
          </div>
        </>
      )}
    </>
  );
}
