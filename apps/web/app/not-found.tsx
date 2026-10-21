import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-2xl rounded-xl bg-signature-cream p-10 text-ink sm:p-14">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-signature-coral" aria-hidden />
          <p className="text-[10px] font-medium tracking-[0.18em] text-[#41454d] uppercase">
            404 — Not found
          </p>
        </div>
        <h1 className="mt-4 text-[38px] leading-[1.1] font-normal tracking-[-0.03em] sm:text-[48px]">
          This page does not exist.
        </h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-[#41454d]">
          The page you are looking for may have moved, or the link is out of date. Head back to the
          dashboard and pick up where you left off.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-11 items-center justify-center rounded-xl bg-foreground px-6 text-sm font-medium text-background shadow-sm transition-transform active:scale-[0.98]"
        >
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
