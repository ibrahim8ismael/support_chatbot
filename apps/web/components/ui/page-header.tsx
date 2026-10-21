import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Small editorial label above the title, e.g. "Knowledge" or "Insights". */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /** Page-level actions, usually one primary and one secondary at most. */
  actions?: ReactNode;
}

/**
 * Shared page masthead. Keeps every dashboard view on the same editorial rhythm:
 * a small eyebrow, a calm display title, supporting copy and an action cluster.
 */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-5 border-b border-separator pb-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? (
          <div className="mb-3 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-signature-coral" aria-hidden />
            <p className="text-[10px] font-medium tracking-[0.18em] text-muted uppercase">
              {eyebrow}
            </p>
          </div>
        ) : null}
        <h1 className="text-[30px] leading-[1.15] font-normal tracking-[-0.03em] text-foreground sm:text-[34px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
