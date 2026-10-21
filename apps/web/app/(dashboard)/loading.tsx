export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading page</span>
      <div className="animate-pulse border-b border-separator pb-6">
        <div className="h-3 w-24 rounded bg-surface-tertiary" />
        <div className="mt-4 h-9 w-56 max-w-full rounded bg-surface-tertiary" />
        <div className="mt-3 h-4 w-96 max-w-full rounded bg-surface-secondary" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <div className="min-h-56 animate-pulse rounded-xl border border-separator bg-surface-secondary" />
        <div className="min-h-80 animate-pulse rounded-xl border border-separator bg-surface-secondary" />
      </div>
    </div>
  );
}
