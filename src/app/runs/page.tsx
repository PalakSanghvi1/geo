'use client';

import { useCallback, useMemo, useState } from 'react';
import { PageHeader } from '@/app/_components/filters';
import { Toast, type ToastMessage } from '@/app/_components/toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  ErrorState,
  METER_W,
  Meter,
  FieldLabel,
  Skeleton,
  cx,
} from '@/app/_components/ui';
import { triggerRun, useRuns } from '@/app/_lib/fetcher';
import { ANSWER_MODELS } from '@/lib/config';
import type { Run, RunRow, RunStatus } from '@/lib/types';

const CELL = 'px-5 py-3';
const ROW = 'border-b border-hairline last:border-0';
const SKELETON_ROWS = 6;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** 'YYYY-MM-DD' → 'Sep 13'. Parsed by hand: `new Date(s)` shifts the day west of UTC. */
function formatRunDate(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return value;
  const month = MONTHS[Number(parts[2]) - 1];
  return month ? `${month} ${Number(parts[3])}` : value;
}

/** 'YYYY-MM-DD HH:MM:SS' → epoch seconds; null for anything else. */
function parseStamp(value: string | null): number | null {
  if (!value) return null;
  const p = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!p) return null;
  const ms = Date.UTC(
    Number(p[1]), Number(p[2]) - 1, Number(p[3]),
    Number(p[4]), Number(p[5]), Number(p[6])
  );
  return Number.isNaN(ms) ? null : ms / 1000;
}

/** '8m 12s'. An unfinished — or unparseable — run has no duration to show. */
function formatDuration(run: Run): string {
  const start = parseStamp(run.started_at);
  const end = parseStamp(run.finished_at);
  if (start === null || end === null || end < start) return '—';
  const total = Math.round(end - start);
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, '0')}m ${seconds}s`
    : `${minutes}m ${seconds}s`;
}

/** 'Claude Sonnet 5' → 'Claude · Sonnet 5'. */
function modelOverline(label: string): string {
  const space = label.indexOf(' ');
  return space === -1 ? label : `${label.slice(0, space)} · ${label.slice(space + 1)}`;
}

/* ------------------------------------------------------------------ */
/* Provider health                                                     */
/* ------------------------------------------------------------------ */

interface ProviderHealth {
  provider: string;
  label: string;
  ok: number;
  total: number;
  failed: number;
  /** The run these counts came from is still executing, so failures may still be retried. */
  inFlight: boolean;
}

/**
 * Real per-provider counts, read from `/api/runs`'s `byProvider` split.
 *
 * This used to approximate — dividing `total_calls` evenly across models and charging
 * every failure to the last one — which invented per-provider numbers on the one page
 * whose job is to report what actually happened.
 *
 * The run is also chosen honestly: health describes the newest run that was actually
 * COLLECTED. Reading a synthetic run would report "45/45, healthy" for a provider on
 * the strength of fabricated rows, which is the same over-claim the chart caption
 * exists to prevent.
 */
function providerHealth(run: RunRow | undefined): ProviderHealth[] {
  const inFlight = run?.status === 'running';
  const counts = new Map(run?.byProvider.map((p) => [p.provider, p]) ?? []);
  return ANSWER_MODELS.map((model) => {
    const c = counts.get(model.provider);
    return {
      provider: model.provider,
      label: model.label,
      total: c?.total ?? 0,
      ok: c?.ok ?? 0,
      failed: c?.failed ?? 0,
      inFlight,
    };
  });
}

/** Newest run that was genuinely collected — never a fabricated one. */
function newestRealRun(runs: RunRow[]): RunRow | undefined {
  return runs.find((r) => r.trigger !== 'synthetic' && r.total_calls > 0);
}

function HealthCard({ health }: { health: ProviderHealth }) {
  const degraded = health.failed > 0;
  // "healthy" with nothing collected would be a claim we can't support.
  const unknown = health.total === 0;
  return (
    <Card className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <FieldLabel>{modelOverline(health.label)}</FieldLabel>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="numeric text-[22px] leading-none font-semibold">{health.ok}</span>
          <span className="numeric text-[22px] leading-none text-ink-muted">/{health.total}</span>
          <span className="text-[13px] text-ink-muted">
            {/* Retries happen inside the call, so on a finished run a failure row is
                final — only a run still executing can honestly say "retrying". */}
            {degraded
              ? `${health.failed} ${health.inFlight ? 'retrying' : 'failed'}`
              : 'answers'}
          </span>
        </div>
      </div>
      {unknown ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-ink/20" aria-hidden />
          no data
        </span>
      ) : degraded ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-warn">
          <span aria-hidden>⚠</span>
          degraded
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-up">
          <span className="h-1.5 w-1.5 rounded-full bg-up" aria-hidden />
          healthy
        </span>
      )}
    </Card>
  );
}

function HealthSkeleton() {
  return (
    <Card className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-3 w-14" />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */

const STATUS: Record<RunStatus, { dot: string; text: string; glyph?: string }> = {
  running: { dot: 'bg-accent', text: 'text-accent-ink' },
  complete: { dot: 'bg-up', text: 'text-up' },
  partial: { dot: '', text: 'text-warn', glyph: '⚠' },
  failed: { dot: 'bg-down', text: 'text-down' },
};

function StatusCell({ status }: { status: RunStatus }) {
  const tone = STATUS[status];
  return (
    <span className={cx('flex items-center gap-2 capitalize', tone.text)}>
      {tone.glyph ? (
        <span aria-hidden>{tone.glyph}</span>
      ) : (
        <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
      )}
      {status}
    </span>
  );
}

function HeaderRow() {
  return (
    <thead>
      <tr className="border-b border-hairline">
        {['Run', 'Date', 'Trigger', 'Status', 'Coverage', 'Duration'].map((label) => (
          <th key={label} scope="col" className={cx(CELL, 'field-label text-left')}>
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function TableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <tr key={i} className={ROW}>
          <td className={CELL}><Skeleton className="h-3 w-8" /></td>
          <td className={CELL}><Skeleton className="h-3 w-12" /></td>
          <td className={CELL}><Skeleton className="h-4 w-20" /></td>
          <td className={CELL}><Skeleton className="h-3 w-16" /></td>
          <td className={CELL}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-[3px] w-[170px]" />
              <Skeleton className="h-3 w-12" />
            </div>
          </td>
          <td className={CELL}><Skeleton className="h-3 w-12" /></td>
        </tr>
      ))}
    </tbody>
  );
}

function RunRow({ run }: { run: Run }) {
  return (
    <tr className={cx(ROW, run.status === 'running' && 'bg-accent-wash')}>
      <td className={cx(CELL, 'numeric font-medium')}>#{run.id}</td>
      <td className={cx(CELL, 'whitespace-nowrap')}>{formatRunDate(run.run_date)}</td>
      <td className={CELL}><Badge>{run.trigger}</Badge></td>
      <td className={CELL}><StatusCell status={run.status} /></td>
      <td className={CELL}>
        <div className="flex items-center gap-3">
          <div className={METER_W}>
            <Meter value={run.ok_calls} max={run.total_calls} self={run.status === 'running'} />
          </div>
          <span className="numeric text-ink-muted">
            {run.ok_calls}/{run.total_calls}
          </span>
        </div>
      </td>
      <td className={cx(CELL, 'numeric whitespace-nowrap')}>{formatDuration(run)}</td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function RunNowButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <Button variant="primary" onClick={onClick} disabled={pending} aria-busy={pending}>
      <svg viewBox="0 0 10 10" aria-hidden className="h-2.5 w-2.5 fill-current">
        <path d="M1 0.5 9 5 1 9.5Z" />
      </svg>
      {pending ? 'Queueing…' : 'Run now'}
    </Button>
  );
}

export default function RunsPage() {
  const { data, error, loading, refresh } = useRuns(5000);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [queueing, setQueueing] = useState(false);

  // Newest first, regardless of the order the API happens to return.
  const runs = useMemo(() => [...(data ?? [])].sort((a, b) => b.id - a.id), [data]);
  // The in-flight run has no counts yet, and a synthetic one has no provider to be
  // healthy about — report the newest run that was genuinely collected.
  const health = useMemo(
    () => providerHealth(newestRealRun(runs)),
    [runs]
  );

  const dismissToast = useCallback(() => setToast(null), []);

  const runNow = useCallback(() => {
    setQueueing(true);
    triggerRun('Run now, from the Runs page')
      .then(() => {
        setToast({ text: 'Run queued — it will appear at the top of the table shortly.' });
        refresh();
      })
      .catch((err: unknown) => {
        setToast({ text: err instanceof Error ? err.message : String(err), tone: 'error' });
      })
      .finally(() => setQueueing(false));
  }, [refresh]);

  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Every prompt × model execution, with retries and per-provider health."
      >
        <RunNowButton pending={queueing} onClick={runNow} />
      </PageHeader>

      <div className="flex flex-col gap-4 px-8 pb-12">
        {error && data === null ? (
          <Card>
            <ErrorState message={error} onRetry={refresh} />
          </Card>
        ) : (
          <>
            {error ? <ErrorBanner message={error} onRetry={refresh} /> : null}
            <div className="grid gap-4 md:grid-cols-3">
              {loading
                ? ANSWER_MODELS.map((model) => <HealthSkeleton key={model.provider} />)
                : health.map((item) => <HealthCard key={item.provider} health={item} />)}
            </div>

            <Card>
              {!loading && runs.length === 0 ? (
                <EmptyState
                  title="No runs yet."
                  hint="The first scheduled run lands overnight — or start one now."
                />
              ) : (
                <table className="w-full text-sm">
                  <HeaderRow />
                  {loading ? (
                    <TableSkeleton />
                  ) : (
                    <tbody>
                      {runs.map((run) => (
                        <RunRow key={run.id} run={run} />
                      ))}
                    </tbody>
                  )}
                </table>
              )}
              <p className={cx(CELL, 'border-t border-hairline text-[13px] text-ink-muted')}>
                Failed calls retry twice with backoff; a run never crashes — failures become rows.
              </p>
            </Card>
          </>
        )}
      </div>

      <Toast message={toast} onDismiss={dismissToast} />
    </>
  );
}
