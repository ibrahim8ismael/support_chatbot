import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <>
      <h1>Settings</h1>
      <p style={{ color: 'var(--muted)' }}>
        Runtime tuning (bot kill switch, thresholds, prompts) — admin-only writes.
      </p>
    </>
  );
}
