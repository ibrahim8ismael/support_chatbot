import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Conversations' };

export default function ConversationsPage() {
  return (
    <>
      <h1>Conversations</h1>
      <p style={{ color: 'var(--muted)' }}>
        Read-only conversation view (bot state, messages, answer outcomes) — backed by the
        conversations module.
      </p>
    </>
  );
}
