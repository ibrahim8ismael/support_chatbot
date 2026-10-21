import type { ReactNode } from 'react';

export type MetricTone = 'plain' | 'coral' | 'forest' | 'cream' | 'peach' | 'mint' | 'ink';

const TONE_CLASSES: Record<MetricTone, string> = {
  plain: 'border border-separator bg-surface text-foreground',
  coral: 'bg-signature-coral text-white',
  forest: 'bg-signature-forest text-white',
  cream: 'bg-signature-cream text-ink',
  peach: 'bg-signature-peach text-ink',
  mint: 'bg-signature-mint text-ink',
  ink: 'bg-ink text-white',
};

const LABEL_CLASSES: Record<MetricTone, string> = {
  plain: 'text-muted',
  coral: 'text-white/70',
  forest: 'text-white/70',
  cream: 'text-[#41454d]',
  peach: 'text-[#41454d]',
  mint: 'text-[#41454d]',
  ink: 'text-white/70',
};

const DETAIL_CLASSES: Record<MetricTone, string> = {
  plain: 'text-muted',
  coral: 'text-white/70',
  forest: 'text-white/70',
  cream: 'text-[#41454d]/80',
  peach: 'text-[#41454d]/80',
  mint: 'text-[#41454d]/80',
  ink: 'text-white/70',
};

interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** Optional supporting line, e.g. "in the selected range". */
  detail?: ReactNode;
  tone?: MetricTone;
  icon?: ReactNode;
  className?: string;
}

/**
 * A single metric surface. Most metrics stay flat/white; a couple of signature
 * tones per screen give the dashboard the same color-block rhythm as Airtable.
 */
export function MetricCard({
  label,
  value,
  detail,
  tone = 'plain',
  icon,
  className = '',
}: MetricCardProps) {
  return (
    <div
      className={`flex min-h-[118px] flex-col justify-between gap-5 rounded-xl p-5 ${TONE_CLASSES[tone]} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={`text-[10px] font-medium tracking-[0.14em] uppercase ${LABEL_CLASSES[tone]}`}>
          {label}
        </p>
        {icon ? <span className={`shrink-0 ${LABEL_CLASSES[tone]}`}>{icon}</span> : null}
      </div>
      <div>
        <p className="text-[28px] leading-none font-normal tracking-[-0.03em]">{value}</p>
        {detail ? <p className={`mt-2 text-xs ${DETAIL_CLASSES[tone]}`}>{detail}</p> : null}
      </div>
    </div>
  );
}
