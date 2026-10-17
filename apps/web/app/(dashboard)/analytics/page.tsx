import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
  return (
    <>
      <h1>Analytics</h1>
      <p style={{ color: 'var(--muted)' }}>
        Answer/deflection metrics from answer_events — definitions in docs/api/rest-api.md.
      </p>
    </>
  );
}
