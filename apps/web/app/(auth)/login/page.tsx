import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 24 }}>
      <h1>Sign in</h1>
      {/* TODO(auth): wire to POST /auth/login (session cookie flow — docs/api/rest-api.md). */}
      <form method="post" style={{ display: 'grid', gap: 12 }}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
