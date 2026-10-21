'use client';

import { Alert, Button, FieldError, Form, Input, Label, TextField } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { API_BASE_URL } from '@/lib/api';

/** Parse the API's error body; fall back to a status-appropriate message. */
async function loginErrorMessage(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') {
      detail = body.message;
    } else if (Array.isArray(body.message)) {
      detail = body.message.join('; ');
    }
  } catch {
    // Not JSON.
  }

  if (response.status === 429) {
    return detail || 'Too many attempts — wait a minute and try again.';
  }
  if (response.status >= 500) {
    return detail
      ? `The API hit an internal error: ${detail}`
      : `The API hit an internal error (${response.status}) — try again shortly.`;
  }
  return 'Invalid email or password.';
}

/**
 * Client form → `POST /auth/login` (session cookie flow — docs/api/rest-api.md).
 * The cookie is httpOnly, so the browser sends it automatically afterwards.
 */
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });

      if (!response.ok) {
        setError(await loginErrorMessage(response));
        return;
      }

      // Confirm the cookie actually stuck before redirecting — a cookie that
      // the browser drops would otherwise bounce the dashboard back to /login.
      const me = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
      if (!me.ok) {
        setError(
          'Signed in, but the session cookie was not accepted — check that the dashboard and API share a site (or use HTTPS).',
        );
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Cannot reach the API — is it running?');
    } finally {
      setPending(false);
    }
  }

  return (
    <Form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <TextField isRequired>
        <Label>Email</Label>
        <Input name="email" type="email" autoComplete="email" placeholder="you@company.com" />
        <FieldError />
      </TextField>

      <TextField isRequired>
        <Label>Password</Label>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
        />
        <FieldError />
      </TextField>

      {error ? (
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Sign-in failed</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <Button type="submit" fullWidth isPending={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </Form>
  );
}
