import type { Metadata } from 'next';

import { KnowledgeBasesView } from './knowledge-bases-view';

export const metadata: Metadata = { title: 'Knowledge bases' };

export default function KnowledgeBasesPage() {
  return <KnowledgeBasesView />;
}
