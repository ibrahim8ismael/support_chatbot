'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { API_BASE_URL } from '@/lib/api';

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

      if (response.ok) {
        router.push('/');
        router.refresh();
        return;
      }

      setError(
        response.status === 429
          ? 'Too many attempts — wait a minute and try again.'
          : 'Invalid email or password.',
      );
    } catch {
      setError('Cannot reach the API — is it running?');
    }
    setPending(false);
  }

  return (
    <form method="post" onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      <button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
