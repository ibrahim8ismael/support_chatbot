import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Inbox bindings' };

export default function BindingsPage() {
  return (
    <>
      <h1>Inbox bindings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Map Chatwoot inboxes to knowledge bases and toggle the per-inbox kill switch (bindings
        module).
      </p>
    </>
  );
}
