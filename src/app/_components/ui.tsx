import type { ReactNode } from 'react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** The one surface primitive: hairline border, near-white fill, no shadow. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('rounded-card border border-hairline bg-card', className)}>{children}</div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline px-5 py-4">
      {children}
    </div>
  );
}

export function Overline({ children }: { children: ReactNode }) {
  return <div className="overline">{children}</div>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'up' | 'down' | 'warn';
}) {
  const tones = {
    neutral: 'border-hairline-strong text-ink-muted',
    accent: 'border-accent/30 bg-accent-wash text-accent',
    up: 'border-up/30 text-up',
    down: 'border-down/30 text-down',
    warn: 'border-warn/30 text-warn',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em] uppercase',
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

/**
 * A signed change. `invert` flips the colour polarity for metrics where lower
 * is better (average position), so "improving" is always green.
 */
export function Delta({
  value,
  invert = false,
  suffix = '',
  className,
}: {
  value: number;
  invert?: boolean;
  suffix?: string;
  className?: string;
}) {
  if (Math.abs(value) < 0.05) {
    return <span className={cx('numeric text-ink-faint', className)}>—</span>;
  }
  const rising = value > 0;
  const good = invert ? !rising : rising;
  return (
    <span className={cx('numeric', good ? 'text-up' : 'text-down', className)}>
      {rising ? '↑' : '↓'} {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}

/** Proportion bar behind the visibility numbers in the scoreboard. */
export function Meter({ value, max = 100, self = false }: { value: number; max?: number; self?: boolean }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-hairline" aria-hidden>
      <div
        className={cx('h-full rounded-full', self ? 'bg-accent' : 'bg-ink/70')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded bg-hairline', className)} />;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 px-5 py-8">
      <Overline>Could not load</Overline>
      <p className="max-w-xl text-sm text-ink-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded border border-hairline-strong px-2.5 py-1 text-sm text-ink transition-colors hover:bg-canvas"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-start gap-1 px-5 py-10">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="text-sm text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** Placeholder for pages owned by later phases, so the nav is never a dead end. */
export function ComingSoon({ page, phase }: { page: string; phase: string }) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-1.5 px-5 py-10">
        <Overline>{phase}</Overline>
        <p className="text-sm text-ink-muted">
          The {page} view is built in {phase}. The route and navigation are in place so the shell
          can be reviewed end to end.
        </p>
      </div>
    </Card>
  );
}
