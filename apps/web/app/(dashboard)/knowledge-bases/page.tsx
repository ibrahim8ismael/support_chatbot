import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Knowledge bases' };

export default function KnowledgeBasesPage() {
  return (
    <>
      <h1>Knowledge bases</h1>
      <p style={{ color: 'var(--muted)' }}>
        KB list, document upload, and ingestion status arrive with the knowledge-base module API.
      </p>
    </>
  );
}
