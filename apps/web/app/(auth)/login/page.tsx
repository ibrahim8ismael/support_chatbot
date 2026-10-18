import type { Metadata } from 'next';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />

      <div className="relative flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-accent text-lg font-semibold text-accent-foreground shadow-lg">
            SA
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Support Agent</h1>
            <p className="text-sm text-muted">Sign in to the operations dashboard</p>
          </div>
        </div>

        <LoginForm />

        <p className="text-center text-xs text-muted">Internal tool — authorized staff only.</p>
      </div>
    </main>
  );
}
