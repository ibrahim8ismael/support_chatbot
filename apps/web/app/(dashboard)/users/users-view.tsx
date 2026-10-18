'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  USER_ROLES,
  userCreateSchema,
  userUpdateSchema,
  type UserRole,
  type UserSummary,
  type UserUpdate,
} from '@support-agent/shared';

import { USER_ROLE_LABELS } from '@/lib/admin';
import { ApiError, apiFetch } from '@/lib/api';

interface RowDraft {
  name: string;
  role: UserRole;
  isActive: boolean;
}

function draftFor(user: UserSummary, drafts: Record<string, RowDraft>): RowDraft {
  return drafts[user.id] ?? { name: user.name, role: user.role, isActive: user.isActive };
}

function changedPatch(user: UserSummary, draft: RowDraft): UserUpdate {
  const patch: UserUpdate = {};
  const name = draft.name.trim();
  if (name !== user.name) {
    patch.name = name;
  }
  if (draft.role !== user.role) {
    patch.role = draft.role;
  }
  if (draft.isActive !== user.isActive) {
    patch.isActive = draft.isActive;
  }
  return patch;
}

/**
 * Users (T-304, admin only — security.md § 2): create accounts, edit
 * name/role/active state, reset passwords. Deactivating an account or
 * resetting a password drops that user's sessions server-side; create/edit
 * inputs go through the same shared schemas the API validates with.
 */
export function UsersView() {
  const router = useRouter();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createName, setCreateName] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('viewer');
  const [createPassword, setCreatePassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    void apiFetch<UserSummary[]>('/users')
      .then((rows) => {
        if (!cancelled) {
          setUsers(rows);
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
  }, [handleError]);

  async function createUser(): Promise<void> {
    setError(null);
    setNotice(null);

    const parsed = userCreateSchema.safeParse({
      email: createEmail.trim(),
      name: createName,
      role: createRole,
      password: createPassword,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid user details');
      return;
    }

    setBusy('create');
    try {
      const created = await apiFetch<UserSummary>('/users', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setUsers((rows) => [...rows, created]);
      setCreateEmail('');
      setCreateName('');
      setCreatePassword('');
      setNotice(`Created ${created.email}.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setError('User management is admin-only.');
      } else {
        handleError(cause);
      }
    } finally {
      setBusy(null);
    }
  }

  async function saveUser(user: UserSummary): Promise<void> {
    const patch = changedPatch(user, draftFor(user, drafts));
    if (Object.keys(patch).length === 0) {
      return;
    }
    const parsed = userUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid changes');
      return;
    }

    setError(null);
    setNotice(null);
    setBusy(user.id);
    try {
      const updated = await apiFetch<UserSummary>(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
      });
      setUsers((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      setDrafts((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
      setNotice(
        updated.isActive
          ? `Saved ${updated.email}.`
          : `Saved ${updated.email} — account deactivated, all of its sessions were revoked.`,
      );
    } catch (cause) {
      handleError(cause);
    } finally {
      setBusy(null);
    }
  }

  async function resetUserPassword(user: UserSummary): Promise<void> {
    setError(null);
    setNotice(null);
    if (resetPassword.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }

    setBusy(user.id);
    try {
      await apiFetch<{ status: 'ok' }>(`/users/${user.id}/password`, {
        method: 'POST',
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetFor(null);
      setResetPassword('');
      setNotice(`Password reset for ${user.email} — their sessions were revoked.`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) {
        setError('Password resets are admin-only.');
      } else {
        handleError(cause);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1>Users</h1>
      <p style={{ color: 'var(--muted)' }}>
        Accounts and roles. Deactivated users keep their history; sessions are revoked on
        deactivation and on password change.
      </p>

      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      {notice ? <p style={{ color: 'var(--muted)' }}>{notice}</p> : null}

      {forbidden ? (
        <p style={{ color: 'var(--muted)' }}>
          User management is admin-only — ask an admin if you need access.
        </p>
      ) : (
        <>
          {loading ? <p style={{ color: 'var(--muted)' }}>Loading…</p> : null}

          {!loading ? (
            <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 900 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={{ padding: '4px 8px 4px 0' }}>User</th>
                  <th style={{ padding: '4px 8px' }}>Name</th>
                  <th style={{ padding: '4px 8px' }}>Role</th>
                  <th style={{ padding: '4px 8px' }}>Active</th>
                  <th style={{ padding: '4px 0 4px 8px' }} />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const draft = draftFor(user, drafts);
                  const dirty = Object.keys(changedPatch(user, draft)).length > 0;
                  const busyRow = busy === user.id;
                  return (
                    <tr key={user.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px 6px 0' }}>
                        <div>{user.email}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                          joined {new Date(user.createdAt).toISOString().slice(0, 10)}
                        </div>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [user.id]: { ...draft, name: event.target.value },
                            }))
                          }
                          style={{ width: 140 }}
                        />
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <select
                          value={draft.role}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [user.id]: { ...draft, role: event.target.value as UserRole },
                            }))
                          }
                        >
                          {USER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {USER_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        <input
                          type="checkbox"
                          checked={draft.isActive}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [user.id]: { ...draft, isActive: event.target.checked },
                            }))
                          }
                        />
                      </td>
                      <td style={{ padding: '6px 0 6px 8px', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          disabled={!dirty || busyRow}
                          onClick={() => void saveUser(user)}
                        >
                          {busyRow ? 'Saving…' : 'Save'}
                        </button>{' '}
                        <button
                          type="button"
                          disabled={busyRow}
                          onClick={() => {
                            setResetFor(resetFor === user.id ? null : user.id);
                            setResetPassword('');
                          }}
                        >
                          Reset password
                        </button>
                        {resetFor === user.id ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              marginTop: 6,
                            }}
                          >
                            <input
                              type="password"
                              placeholder="New password (12+ chars)"
                              value={resetPassword}
                              onChange={(event) => setResetPassword(event.target.value)}
                            />
                            <button
                              type="button"
                              disabled={busyRow}
                              onClick={() => void resetUserPassword(user)}
                            >
                              Confirm
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}

          <h2 style={{ fontSize: 16, marginTop: 24 }}>Add a user</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="email"
              placeholder="email"
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
            />
            <input
              placeholder="name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
            />
            <select
              value={createRole}
              onChange={(event) => setCreateRole(event.target.value as UserRole)}
            >
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {USER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <input
              type="password"
              placeholder="password (12+ chars)"
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
            />
            <button type="button" disabled={busy === 'create'} onClick={() => void createUser()}>
              {busy === 'create' ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
