import type { ReactNode } from 'react';

type StatCardProps = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** CSS color value, e.g. 'var(--color-positive)' — overrides the default text-primary value color. */
  valueColor?: string;
  /** Small ticker-style tag rendered next to the value. */
  chip?: string;
};

export default function StatCard({ label, value, sub, valueColor, chip }: StatCardProps) {
  return (
    <div
      className="min-w-0 flex-1 basis-55 rounded-(--radius-md) border border-(--color-border) border-t-2 bg-white px-5 py-4 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm"
      style={{ borderTopColor: valueColor ?? 'var(--color-accent)' }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[22px] font-bold text-foreground" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </span>
        {chip && (
          <span className="rounded-(--radius-sm) bg-(--color-chip-bg) px-1.5 py-0.5 text-xs font-semibold text-(--color-chip-text)">
            {chip}
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</div>}
    </div>
  );
}
