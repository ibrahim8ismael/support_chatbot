'use client';

import { Alert, Avatar, Button, Drawer, Dropdown, Label, useOverlayState } from '@heroui/react';
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronDown,
  Inbox,
  LogOut,
  Menu,
  MessagesSquare,
  Play,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import type { SessionUser } from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';

import { ThemeToggle } from './theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: 'Knowledge',
    items: [
      { href: '/knowledge-bases', label: 'Knowledge bases', icon: BookOpen },
      { href: '/playground', label: 'Playground', icon: Play },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/conversations', label: 'Conversations', icon: MessagesSquare },
      { href: '/bindings', label: 'Inbox bindings', icon: Inbox },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/users', label: 'Users', icon: Users },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((group) => group.items);

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/knowledge-bases" onClick={onNavigate} className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-sm">
        <Bot className="size-5" aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">Support Agent</span>
        <span className="text-[11px] text-muted">Operations dashboard</span>
      </span>
    </Link>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-6">
      {NAV.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-muted uppercase">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-accent/10 font-medium text-accent'
                        : 'text-muted hover:bg-surface-secondary hover:text-foreground'
                    }`}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function AccountMenu({
  user,
  signingOut,
  onSignOut,
}: {
  user: SessionUser | null;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const fallback = user ? initials(user.name || user.email) : '?';

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full p-1 pr-1.5 text-left"
      >
        <Avatar size="sm" color="accent">
          <Avatar.Fallback>{fallback}</Avatar.Fallback>
        </Avatar>
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="max-w-40 truncate text-sm font-medium text-foreground">
            {user?.name ?? 'Account'}
          </span>
          <span className="max-w-40 truncate text-[11px] text-muted">
            {user?.email ?? 'Loading…'}
          </span>
        </span>
        <ChevronDown className="size-3.5 text-muted" aria-hidden />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom right">
        <Dropdown.Menu
          aria-label="Account actions"
          disabledKeys={signingOut ? ['sign-out'] : []}
          onAction={(key) => {
            if (key === 'sign-out') onSignOut();
          }}
        >
          <Dropdown.Item id="sign-out" textValue="Sign out">
            <LogOut className="size-4" aria-hidden />
            <Label>{signingOut ? 'Signing out…' : 'Sign out'}</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/**
 * Dashboard chrome: grouped sidebar (desktop), drawer (mobile), sticky header
 * with theme toggle and the account menu. Server data stays in the pages.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const drawer = useOverlayState();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<{ user: SessionUser }>('/auth/me')
      .then((response) => {
        if (active) setUser(response.user);
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  const current = ALL_ITEMS.find((item) => isActive(pathname, item.href));

  async function signOut(): Promise<void> {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (cause) {
      // Never claim success while the server session is still alive.
      setSigningOut(false);
      setSignOutError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : 'The API did not confirm the sign-out.',
      );
      return;
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-separator bg-surface lg:flex">
        <div className="flex h-16 items-center border-b border-separator px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav pathname={pathname} />
        </div>
        <div className="border-t border-separator px-5 py-4">
          <p className="text-[11px] font-medium tracking-wider text-muted uppercase">Role</p>
          <p className="mt-0.5 text-sm font-medium capitalize">{user?.role ?? '—'}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-separator bg-background/85 px-4 backdrop-blur lg:px-8">
          <Button
            isIconOnly
            variant="ghost"
            className="lg:hidden"
            aria-label="Open navigation"
            onPress={drawer.open}
          >
            <Menu className="size-5" aria-hidden />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
            {current?.label ?? 'Dashboard'}
          </h1>
          <ThemeToggle />
          <div className="mx-1 h-6 w-px bg-separator" aria-hidden />
          <AccountMenu user={user} signingOut={signingOut} onSignOut={() => void signOut()} />
        </header>

        {signOutError ? (
          <div className="px-4 pt-4 lg:px-8">
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Sign out failed — you are still signed in</Alert.Title>
                <Alert.Description>{signOutError}</Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        ) : null}

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>

      <Drawer state={drawer}>
        <Drawer.Backdrop>
          <Drawer.Content placement="left" className="w-72 max-w-[85vw]">
            <Drawer.Dialog aria-label="Navigation">
              <Drawer.Header>
                <Brand onNavigate={drawer.close} />
              </Drawer.Header>
              <Drawer.Body className="overflow-y-auto p-3">
                <SidebarNav pathname={pathname} onNavigate={drawer.close} />
              </Drawer.Body>
              <Drawer.Footer className="border-t border-separator">
                <div className="flex w-full items-center gap-2.5">
                  <Avatar size="sm" color="accent">
                    <Avatar.Fallback>
                      {user ? initials(user.name || user.email) : '?'}
                    </Avatar.Fallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user?.name ?? 'Account'}</p>
                    <p className="truncate text-xs text-muted">{user?.email ?? ''}</p>
                  </div>
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label="Sign out"
                    isPending={signingOut}
                    onPress={() => void signOut()}
                  >
                    <LogOut className="size-4" aria-hidden />
                  </Button>
                </div>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
