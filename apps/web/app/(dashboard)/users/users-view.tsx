'use client';

import {
  Alert,
  Button,
  Card,
  Input,
  Label,
  ListBox,
  Select,
  Spinner,
  Switch,
  TextField,
} from '@heroui/react';
import { KeyRound, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  USER_ROLES,
  userCreateSchema,
  userUpdateSchema,
  type UserRole,
  type UserSummary,
  type UserUpdate,
} from '@support-agent/shared';

import { useSessionUser } from '@/components/session';
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
  const me = useSessionUser();
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
      setCreateRole('viewer');
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

  const activeAdminCount = users.filter((row) => row.role === 'admin' && row.isActive).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight">Users</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Accounts and roles. Deactivated users keep their history; sessions are revoked on
          deactivation and on password change.
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
      {notice ? (
        <Alert status="success" role="status">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{notice}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {forbidden ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Read-only for your role</Alert.Title>
            <Alert.Description>
              User management is admin-only — ask an admin if you need access.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {users.map((user) => {
              const draft = draftFor(user, drafts);
              const dirty = Object.keys(changedPatch(user, draft)).length > 0;
              const busyRow = busy === user.id;
              // Mirror the server's lockout guards (users.service.ts) in the UI:
              // no self-demote/deactivate, keep at least one active admin.
              const isSelf = me !== null && me.id === user.id;
              const lastActiveAdmin =
                user.role === 'admin' && user.isActive && activeAdminCount === 1;
              const lock = isSelf || lastActiveAdmin;
              const lockNote = isSelf
                ? 'You cannot change your own role or deactivate your own account.'
                : lastActiveAdmin
                  ? 'At least one active admin must remain — promote another admin first.'
                  : null;
              return (
                <Card key={user.id}>
                  <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Card.Title className="text-base">{user.email}</Card.Title>
                      <Card.Description>
                        joined {new Date(user.createdAt).toISOString().slice(0, 10)}
                      </Card.Description>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Switch
                        size="sm"
                        isSelected={draft.isActive}
                        isDisabled={busyRow || lock}
                        onChange={(isActive) =>
                          setDrafts((current) => ({
                            ...current,
                            [user.id]: { ...draft, isActive },
                          }))
                        }
                      >
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Content>
                          <Label>Active</Label>
                        </Switch.Content>
                      </Switch>
                      <Button
                        size="sm"
                        isDisabled={!dirty || busyRow}
                        isPending={busyRow}
                        onPress={() => void saveUser(user)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        isDisabled={busyRow}
                        onPress={() => {
                          setResetFor(resetFor === user.id ? null : user.id);
                          setResetPassword('');
                        }}
                      >
                        <KeyRound className="size-4" aria-hidden />
                        Reset password
                      </Button>
                    </div>
                  </Card.Header>

                  <Card.Content className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <TextField
                        className="w-60"
                        value={draft.name}
                        isDisabled={busyRow}
                        onChange={(name) =>
                          setDrafts((current) => ({
                            ...current,
                            [user.id]: { ...draft, name },
                          }))
                        }
                      >
                        <Label>Name</Label>
                        <Input />
                      </TextField>

                      <Select
                        className="w-40"
                        value={draft.role}
                        isDisabled={busyRow || lock}
                        onChange={(role) => {
                          if (typeof role !== 'string') {
                            return;
                          }
                          setDrafts((current) => ({
                            ...current,
                            [user.id]: { ...draft, role: role as UserRole },
                          }));
                        }}
                      >
                        <Label>Role</Label>
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {USER_ROLES.map((role) => (
                              <ListBox.Item key={role} id={role} textValue={USER_ROLE_LABELS[role]}>
                                {USER_ROLE_LABELS[role]}
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>

                    {lockNote ? <p className="text-xs text-muted">{lockNote}</p> : null}

                    {resetFor === user.id ? (
                      <form
                        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-secondary/50 p-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void resetUserPassword(user);
                        }}
                      >
                        <TextField
                          className="w-64"
                          value={resetPassword}
                          isDisabled={busyRow}
                          onChange={setResetPassword}
                        >
                          <Label>New password</Label>
                          <Input
                            type="password"
                            placeholder="12+ characters"
                            autoComplete="new-password"
                          />
                        </TextField>
                        <Button type="submit" size="sm" isPending={busyRow}>
                          Confirm reset
                        </Button>
                        {isSelf ? (
                          <p className="w-full text-xs text-muted">
                            This signs out every session of your account, including this one.
                          </p>
                        ) : null}
                      </form>
                    ) : null}
                  </Card.Content>
                </Card>
              );
            })}
          </div>

          <Card className="max-w-3xl">
            <Card.Header>
              <Card.Title className="text-base">Add a user</Card.Title>
              <Card.Description>
                New accounts get the selected role immediately; passwords must be at least 12
                characters.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createUser();
                }}
              >
                <TextField value={createEmail} onChange={setCreateEmail} isRequired>
                  <Label>Email</Label>
                  <Input type="email" autoComplete="off" />
                </TextField>
                <TextField value={createName} onChange={setCreateName} isRequired>
                  <Label>Name</Label>
                  <Input autoComplete="off" />
                </TextField>
                <Select
                  value={createRole}
                  onChange={(role) => {
                    if (typeof role === 'string') {
                      setCreateRole(role as UserRole);
                    }
                  }}
                >
                  <Label>Role</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {USER_ROLES.map((role) => (
                        <ListBox.Item key={role} id={role} textValue={USER_ROLE_LABELS[role]}>
                          {USER_ROLE_LABELS[role]}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                <TextField value={createPassword} onChange={setCreatePassword} isRequired>
                  <Label>Password</Label>
                  <Input type="password" placeholder="12+ characters" autoComplete="new-password" />
                </TextField>
                <div className="sm:col-span-2">
                  <Button type="submit" isPending={busy === 'create'}>
                    <UserPlus className="size-4" aria-hidden />
                    Create user
                  </Button>
                </div>
              </form>
            </Card.Content>
          </Card>
        </>
      )}
    </div>
  );
}
