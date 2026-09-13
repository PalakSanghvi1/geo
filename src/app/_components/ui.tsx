import type { ReactNode } from 'react';

/** One bar width across the scoreboard, prompts, runs and sources tables. */
export const METER_W = 'w-[160px]';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** The one surface primitive: hairline border, near-white fill, no shadow. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx('rounded-card border border-hairline bg-card', className)}>{children}</div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[15px] font-medium">{children}</h2>;
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

type ButtonVariant = 'primary' | 'outline' | 'ghost';

/**
 * The three button weights the dashboard uses. Primary is the dark fill and
 * there is at most one per screen — "Run now", "Approve & track".
 */
export function Button({
  variant = 'outline',
  className,
  children,
  ...props
}: { variant?: ButtonVariant } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-ink text-canvas hover:bg-ink/90 border border-ink',
    outline: 'border border-hairline-strong bg-card text-ink hover:bg-canvas',
    ghost: 'border border-transparent text-ink-muted hover:text-ink',
  };
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className
      )}
    >
      {children}
    </button>
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
        <Button className="mt-1" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A failed refresh when data is already on screen. Replacing a populated page
 * with an error card loses everything the reader was looking at — and on the
 * Runs page, which polls every five seconds, one blip would do it mid-demo.
 */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-down/30 px-5 py-3">
      <p className="text-sm text-ink-muted">{message}</p>
      {onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
    </Card>
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
