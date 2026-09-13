'use client';

import { useEffect, useMemo, useState } from 'react';
import { PageHeader, RangeSelect, Segmented } from '@/app/_components/filters';
import { Badge, Button, Card, EmptyState, ErrorBanner, ErrorState, METER_W, Meter, FieldLabel, Skeleton, cx } from '@/app/_components/ui';
import { useSources, type ProviderParam } from '@/app/_lib/fetcher';
import type { SourceRow } from '@/lib/types';

const PROVIDERS: Array<{ value: ProviderParam; label: string }> = [
  { value: 'all', label: 'All models' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'openai', label: 'GPT' },
  { value: 'gemini', label: 'Gemini' },
];

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
];

/** Domains shown before the reader asks for the long tail. */
const COLLAPSED = 10;

const CELL = 'px-5 py-3';

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function bareHost(host: string): string {
  return host.replace(/^www\./, '').toLowerCase();
}

/**
 * The host is already the row, so a cited page reads better as its path. Falls
 * back to the whole URL when the path carries nothing (a bare homepage) or when
 * the URL does not parse / sits on a different host than the row claims.
 */
function urlLabel(url: string, domain: string): string {
  try {
    const parsed = new URL(url);
    if (bareHost(parsed.host) !== bareHost(domain)) return url;
    const path = `${parsed.pathname}${parsed.search}`;
    return path === '' || path === '/' ? url : path;
  } catch {
    return url;
  }
}

/** One precision down the column; a real citation floors at <1% rather than rounding to 0%. */
function sharePct(count: number, total: number): string {
  if (total <= 0) return '0%';
  const pct = (count / total) * 100;
  if (pct > 0 && pct < 0.5) return '<1%';
  return `${pct.toFixed(0)}%`;
}

function HeaderRow() {
  return (
    <thead>
      <tr className="border-b border-hairline">
        <th scope="col" className={cx(CELL, 'field-label text-left')}>
          Domain
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left whitespace-nowrap')}>
          Citations
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left whitespace-nowrap')}>
          Share
        </th>
      </tr>
    </thead>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cx(
        'h-3 w-3 shrink-0 text-ink-faint transition-transform',
        open && 'rotate-90'
      )}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

function Favicon({ domain }: { domain: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      referrerPolicy="no-referrer"
      // Offline, every one of these 404s — a column of broken-image glyphs.
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
      className="h-3.5 w-3.5 shrink-0 rounded-[2px]"
    />
  );
}

function DomainRows({
  row,
  total,
  open,
  onToggle,
}: {
  row: SourceRow;
  total: number;
  open: boolean;
  onToggle: () => void;
}) {
  const urls = row.urls ?? [];
  const expandable = urls.length > 0;

  const label = (
    <>
      <Favicon domain={row.domain} />
      <span className="truncate">{row.domain}</span>
    </>
  );

  return (
    <tbody>
      <tr className="border-b border-hairline">
        <td className={CELL}>
          <div className="flex min-w-0 items-center gap-2">
            {expandable ? (
              <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className={cx(
                  'flex min-w-0 items-center gap-2.5 text-left transition-colors hover:text-accent-ink',
                  FOCUS_RING
                )}
              >
                <Chevron open={open} />
                {label}
                <span className="sr-only">
                  — {urls.length} cited {urls.length === 1 ? 'page' : 'pages'}
                </span>
              </button>
            ) : (
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="h-3 w-3 shrink-0" aria-hidden />
                {label}
              </span>
            )}
            {row.isCompetitorOwned ? <Badge tone="warn">Competitor</Badge> : null}
          </div>
        </td>
        <td className={cx(CELL, 'numeric whitespace-nowrap')}>{row.citationCount}</td>
        <td className={CELL}>
          <div className="flex items-center gap-3">
            {/* Same denominator as the label beside it, so bar and number agree. */}
            <div className={METER_W}>
              <Meter value={row.citationCount} max={total} />
            </div>
            <span className="numeric text-[12px] whitespace-nowrap text-ink-muted">
              {sharePct(row.citationCount, total)}
            </span>
          </div>
        </td>
      </tr>

      {open
        ? urls.map((entry, i) => (
            <tr
              key={entry.url}
              className={cx('bg-canvas', i === urls.length - 1 && 'border-b border-hairline')}
            >
              <td colSpan={3} className="px-5 py-1.5">
                <div className="flex items-baseline gap-4 pl-[26px]">
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={entry.url}
                    className={cx(
                      'min-w-0 flex-1 truncate text-[13px] text-ink-muted transition-colors hover:text-accent-ink',
                      FOCUS_RING
                    )}
                  >
                    {urlLabel(entry.url, row.domain)}
                  </a>
                  <span className="numeric shrink-0 text-[13px] text-ink-muted">
                    ×{entry.count}
                  </span>
                </div>
              </td>
            </tr>
          ))
        : null}
    </tbody>
  );
}

function SourcesSkeleton() {
  return (
    <tbody>
      {Array.from({ length: COLLAPSED }, (_, i) => (
        <tr key={i} className="border-b border-hairline">
          <td className={CELL}>
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-3 w-3" />
              <Skeleton className="h-3.5 w-3.5 rounded-[2px]" />
              <Skeleton className={cx('h-3', i % 3 === 0 ? 'w-44' : 'w-32')} />
            </div>
          </td>
          <td className={CELL}>
            <Skeleton className="h-3 w-8" />
          </td>
          <td className={CELL}>
            <div className="flex items-center gap-3">
              <Skeleton className={cx('h-[3px]', METER_W)} />
              <Skeleton className="h-3 w-7" />
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export default function SourcesPage() {
  const [provider, setProvider] = useState<ProviderParam>('all');
  const [days, setDays] = useState(14);
  const [expanded, setExpanded] = useState(false);
  const [openDomains, setOpenDomains] = useState<ReadonlySet<string>>(new Set());

  // A domain opened under one filter should not stay open under the next.
  useEffect(() => {
    setExpanded(false);
    setOpenDomains(new Set());
  }, [provider, days]);

  const sources = useSources(days, provider);
  const rows = useMemo(() => sources.data ?? [], [sources.data]);

  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.citationCount, 0),
    [rows]
  );

  const toggleDomain = (domain: string) =>
    setOpenDomains((current) => {
      const next = new Set(current);
      if (!next.delete(domain)) next.add(domain);
      return next;
    });

  const visible = expanded ? rows : rows.slice(0, COLLAPSED);

  return (
    <>
      <PageHeader
        title="Sources"
        subtitle="Which domains the models cite when they answer — and which of them a competitor owns."
      >
        <Segmented
          label="Answer model"
          value={provider}
          options={PROVIDERS}
          onChange={setProvider}
        />
        <RangeSelect label="Date range" value={days} options={RANGES} onChange={setDays} />
      </PageHeader>

      <div className="flex flex-col gap-4 px-8 pb-12">
        {sources.error && sources.data === null ? (
          <Card>
            <ErrorState message={sources.error} onRetry={sources.refresh} />
          </Card>
        ) : (
          <>
            {/* A failed refresh sits above the last good table rather than replacing it. */}
            {sources.error ? (
              <ErrorBanner message={sources.error} onRetry={sources.refresh} />
            ) : null}

            <FieldLabel>
              {sources.loading
                ? 'Loading citations'
                : `${rows.length} ${rows.length === 1 ? 'domain' : 'domains'} · ${total} ${
                    total === 1 ? 'citation' : 'citations'
                  }`}
            </FieldLabel>

            <Card>
              {!sources.loading && rows.length === 0 ? (
                <EmptyState
                  title="No citations in this window yet."
                  hint="Domains appear here once a run collects answers that cite sources for this model and date range."
                />
              ) : (
                <>
                  <table className="w-full text-sm [&_tbody:last-of-type_tr:last-of-type]:border-0">
                    <HeaderRow />
                    {sources.loading ? (
                      <SourcesSkeleton />
                    ) : (
                      visible.map((row) => (
                        <DomainRows
                          key={row.domain}
                          row={row}
                          total={total}
                          open={openDomains.has(row.domain)}
                          onToggle={() => toggleDomain(row.domain)}
                        />
                      ))
                    )}
                  </table>

                  {rows.length > COLLAPSED ? (
                    <button
                      type="button"
                      onClick={() => setExpanded((open) => !open)}
                      aria-expanded={expanded}
                      className={cx(
                        CELL,
                        'block w-full border-t border-hairline text-left text-[13px] text-accent-ink transition-colors hover:text-ink',
                        FOCUS_RING
                      )}
                    >
                      {expanded ? `Show top ${COLLAPSED} →` : `View all ${rows.length} domains →`}
                    </button>
                  ) : null}
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
