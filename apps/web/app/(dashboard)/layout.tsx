import type { ReactNode } from 'react';
import Link from 'next/link';

const NAV = [
  { href: '/knowledge-bases', label: 'Knowledge bases' },
  { href: '/playground', label: 'Playground' },
  { href: '/conversations', label: 'Conversations' },
  { href: '/bindings', label: 'Inbox bindings' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
  { href: '/users', label: 'Users' },
  { href: '/audit', label: 'Audit log' },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 220, borderRight: '1px solid var(--border)', padding: 16 }}>
        <Link href="/knowledge-bases" style={{ fontWeight: 600 }}>
          Support Agent
        </Link>
        <nav style={{ marginTop: 16 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main style={{ flex: 1, padding: 24 }}>{children}</main>
    </div>
  );
}
