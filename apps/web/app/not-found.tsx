import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <p className="text-sm font-medium tracking-wider text-muted uppercase">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page does not exist</h1>
      <p className="max-w-md text-sm text-muted">
        The page you are looking for may have moved, or the link is out of date.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
      >
        Back to the dashboard
      </Link>
    </main>
  );
}
