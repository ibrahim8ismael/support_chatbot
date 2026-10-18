import type { Metadata } from 'next';

import { BindingsView } from './bindings-view';

export const metadata: Metadata = { title: 'Inbox bindings' };

export default function BindingsPage() {
  return <BindingsView />;
}
