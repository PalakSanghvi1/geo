'use client';

import type { ReactNode } from 'react';
import { cx } from './ui';

export interface Option<T extends string | number> {
  value: T;
  label: string;
}

/** Provider filter — All models / Claude / GPT / Gemini. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-md border border-hairline bg-card p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'rounded px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              active
                ? 'bg-canvas font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)]'
                : 'text-ink-muted hover:text-ink'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Date-range picker. Native select: keyboard and screen-reader support for free. */
export function RangeSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: number;
  options: Option<number>[];
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <label className="relative flex items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="appearance-none rounded-md border border-hairline bg-card py-1.5 pr-8 pl-3 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="pointer-events-none absolute right-2.5 h-3 w-3 text-ink-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m4 6 4 4 4-4" />
      </svg>
    </label>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 px-8 pt-7 pb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-xl text-sm text-ink-muted">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}
