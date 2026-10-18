import type { Metadata } from 'next';

import { ConversationsView } from './conversations-view';

export const metadata: Metadata = { title: 'Conversations' };

export default function ConversationsPage() {
  return <ConversationsView />;
}
