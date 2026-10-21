'use client';

import { Alert, Avatar, Button, Drawer, Dropdown, Label, useOverlayState } from '@heroui/react';
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronDown,
  FlaskConical,
  Inbox,
  LogOut,
  Menu,
  MessagesSquare,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import type { SessionUser, UserRole } from '@support-agent/shared';

import { ApiError, apiFetch } from '@/lib/api';

import { SessionProvider } from './session';
import { ThemeToggle } from './theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles allowed to open the page; omitted = every signed-in role. */
  roles?: readonly UserRole[];
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
      { href: '/sandbox', label: 'Sandbox', icon: FlaskConical },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/conversations', label: 'Conversations', icon: MessagesSquare },
      // Bindings reads are editor/admin on the API (security.md § 2).
      { href: '/bindings', label: 'Inbox bindings', icon: Inbox, roles: ['editor', 'admin'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/audit', label: 'Audit log', icon: ScrollText, roles: ['admin'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/users', label: 'Users', icon: Users, roles: ['admin'] },
    ],
  },
];

const ALL_ITEMS = NAV.flatMap((group) => group.items);

/** Hide pages the current role cannot open; unknown role = gated items hidden. */
function visibleGroups(user: SessionUser | null): NavGroup[] {
  const canOpen = (item: NavItem): boolean =>
    item.roles === undefined || (user !== null && item.roles.includes(user.role));
  return NAV.map((group) => ({ ...group, items: group.items.filter(canOpen) })).filter(
    (group) => group.items.length > 0,
  );
}

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
    <Link
      href="/knowledge-bases"
      onClick={onNavigate}
      className="flex items-center gap-2.5"
      aria-label="Support Agent home"
    >
      <span className="relative flex size-8 items-center justify-center rounded-[10px] bg-foreground text-background shadow-sm">
        <Bot className="size-[18px]" aria-hidden />
        <span
          className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-surface-secondary bg-signature-coral"
          aria-hidden
        />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-medium tracking-[-0.01em] text-foreground">
          Support Agent
        </span>
        <span className="mt-1 text-[10px] tracking-[0.12em] text-muted uppercase">Operations</span>
      </span>
    </Link>
  );
}

function SidebarNav({
  pathname,
  user,
  onNavigate,
}: {
  pathname: string;
  user: SessionUser | null;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-6">
      {visibleGroups(user).map((group) => (
        <div key={group.label}>
          <p className="mb-2 px-2.5 text-[10px] font-medium tracking-[0.14em] text-muted uppercase">
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
                    className={`flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                      active
                        ? 'bg-foreground font-medium text-background shadow-sm'
                        : 'text-muted hover:bg-surface hover:text-foreground'
                    }`}
                  >
                    <Icon
                      className={`size-4 shrink-0 ${active ? 'opacity-100' : 'opacity-75'}`}
                      aria-hidden
                    />
                    <span className="truncate">{item.label}</span>
                    {active ? (
                      <span
                        className="ml-auto size-1.5 rounded-full bg-signature-peach"
                        aria-hidden
                      />
                    ) : null}
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
          <span className="max-w-40 truncate text-[13px] font-medium text-foreground">
            {user?.name ?? 'Account'}
          </span>
          <span className="max-w-40 truncate text-[10px] text-muted">
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

function AccessCard({ user }: { user: SessionUser | null }) {
  return (
    <div className="rounded-[10px] border border-separator bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium tracking-[0.14em] text-muted uppercase">
          Your access
        </p>
        <span className="size-1.5 rounded-full bg-signature-forest" aria-hidden />
      </div>
      <p className="mt-2 text-sm font-medium capitalize">{user?.role ?? '—'}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted">{user?.email ?? 'Checking session…'}</p>
    </div>
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
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSessionError(null);
    apiFetch<{ user: SessionUser }>('/auth/me')
      .then((response) => {
        if (active) setUser(response.user);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          router.replace('/login');
          return;
        }
        // Surface the failure instead of showing "Loading…" forever.
        setSessionError(
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : 'The session check failed.',
        );
      });
    return () => {
      active = false;
    };
  }, [router, sessionToken]);

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
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-separator bg-surface-secondary lg:flex">
        <div className="flex h-16 items-center border-b border-separator px-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 py-5">
          <SidebarNav pathname={pathname} user={user} />
        </div>
        <div className="border-t border-separator p-3">
          <AccessCard user={user} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b border-separator bg-background/90 px-4 backdrop-blur-md lg:px-8">
          <Button
            isIconOnly
            variant="ghost"
            className="lg:hidden"
            aria-label="Open navigation"
            onPress={drawer.open}
          >
            <Menu className="size-5" aria-hidden />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
            <span className="hidden text-muted sm:inline">Workspace</span>
            <span className="hidden text-border sm:inline" aria-hidden>
              /
            </span>
            <span className="truncate font-medium text-foreground">
              {current?.label ?? 'Dashboard'}
            </span>
          </div>
          <ThemeToggle />
          <div className="mx-1 h-6 w-px bg-separator" aria-hidden />
          <AccountMenu user={user} signingOut={signingOut} onSignOut={() => void signOut()} />
        </header>

        {sessionError ? (
          <div className="mx-auto w-full max-w-[1320px] px-4 pt-4 sm:px-6 lg:px-10">
            <Alert status="danger" role="alert">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Session check failed</Alert.Title>
                <Alert.Description>{sessionError}</Alert.Description>
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => setSessionToken((token) => token + 1)}
                  >
                    Retry
                  </Button>
                </div>
              </Alert.Content>
            </Alert>
          </div>
        ) : null}

        {signOutError ? (
          <div className="mx-auto w-full max-w-[1320px] px-4 pt-4 sm:px-6 lg:px-10">
            <Alert status="danger" role="alert">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Sign out failed — you are still signed in</Alert.Title>
                <Alert.Description>{signOutError}</Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        ) : null}

        <main className="flex-1 px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
          <div className="mx-auto w-full max-w-[1320px]">
            <SessionProvider value={user}>{children}</SessionProvider>
          </div>
        </main>
      </div>

      <Drawer state={drawer}>
        <Drawer.Backdrop>
          <Drawer.Content placement="left" className="w-72 max-w-[85vw] bg-surface">
            <Drawer.Dialog aria-label="Navigation">
              <Drawer.Header>
                <Brand onNavigate={drawer.close} />
              </Drawer.Header>
              <Drawer.Body className="overflow-y-auto p-3">
                <SidebarNav pathname={pathname} user={user} onNavigate={drawer.close} />
              </Drawer.Body>
              <Drawer.Footer className="border-t border-separator p-3">
                <div className="flex w-full flex-col gap-3">
                  <AccessCard user={user} />
                  <div className="flex items-center gap-2.5">
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
                </div>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
