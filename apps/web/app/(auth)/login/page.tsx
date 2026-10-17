import type { Metadata } from 'next';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 360, margin: '10vh auto', padding: 24 }}>
      <h1>Sign in</h1>
      <LoginForm />
    </main>
  );
}
