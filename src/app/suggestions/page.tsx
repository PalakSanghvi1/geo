'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Suggestion } from '@/lib/types';
import { PageHeader } from '@/app/_components/filters';
import { Badge, Button, Card, ErrorState, Overline, Skeleton } from '@/app/_components/ui';
import {
  pushSuggestionToLinear,
  resolveSuggestion,
  useSuggestions,
} from '@/app/_lib/fetcher';

/**
 * Rationales are written as "Linear project: <name> — <why>" by Workstream C's
 * scan. Split so the project can head the card, as in the mockup. Anything that
 * doesn't match that shape renders whole, rather than being silently dropped.
 */
function parseRationale(rationale: string): { project: string | null; detail: string } {
  const match = /^\s*Linear project:\s*([^—\n]+?)\s*(?:—\s*([\s\S]*))?$/.exec(rationale);
  if (!match) return { project: null, detail: rationale.trim() };
  return { project: match[1].trim(), detail: (match[2] ?? '').trim() };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Stamps come from SQLite's `datetime('now')`, which is UTC. Comparing them
 * against the browser's local date to say "Today" is wrong west of UTC after
 * about 19:00, so the date is shown plainly and the zone is stated.
 */
function formatScanTime(createdAt: string): string {
  const [date, time = ''] = createdAt.split(' ');
  const [, month, day] = date.split('-').map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return createdAt;
  const label = `${MONTHS[month - 1]} ${day}`;
  return time ? `${label} · ${time.slice(0, 5)} UTC` : label;
}

function titleFor(suggestion: Suggestion): string {
  return suggestion.kind === 'competitor'
    ? `Add competitor: ${suggestion.text}`
    : `Track: “${suggestion.text}”`;
}

/** A suggestion this session has acted on. The API only ever returns pending ones. */
interface Resolved {
  suggestion: Suggestion;
  action: 'approve' | 'dismiss';
  duplicate: boolean;
  linearIssueId: string | null;
}

type Busy = 'approve' | 'dismiss' | 'linear' | null;

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M8 5.5v5M5.5 8h5" />
    </svg>
  );
}

function SuggestionCard({
  suggestion,
  onResolved,
}: {
  suggestion: Suggestion;
  onResolved: (resolved: Resolved) => void;
}) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [linearIssueId, setLinearIssueId] = useState<string | null>(suggestion.linear_issue_id);

  const { project, detail } = parseRationale(suggestion.rationale);

  const resolve = async (action: 'approve' | 'dismiss') => {
    setBusy(action);
    setError(null);
    try {
      const result = await resolveSuggestion(suggestion.id, action);
      onResolved({
        suggestion: result.suggestion ?? suggestion,
        action,
        duplicate: result.created?.duplicate ?? false,
        linearIssueId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const pushToLinear = async () => {
    setBusy('linear');
    setError(null);
    try {
      const result = await pushSuggestionToLinear(suggestion.id);
      setLinearIssueId(result.suggestion?.linear_issue_id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{suggestion.kind}</Badge>
        {project ? (
          <span className="text-[13px] text-ink-muted">
            from Linear project · <span className="text-ink">{project}</span>
          </span>
        ) : null}
      </div>

      <h2 className="mt-2.5 text-[17px] font-semibold tracking-[-0.01em]">
        {titleFor(suggestion)}
      </h2>
      {detail ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-muted">{detail}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => resolve('approve')} disabled={busy !== null}>
          {busy === 'approve' ? 'Approving…' : 'Approve & track'}
        </Button>
        <Button onClick={pushToLinear} disabled={busy !== null || linearIssueId !== null}>
          <PlusIcon />
          {busy === 'linear'
            ? 'Creating…'
            : linearIssueId
              ? `Created ${linearIssueId}`
              : 'Create Linear issue'}
        </Button>
        <Button variant="ghost" onClick={() => resolve('dismiss')} disabled={busy !== null}>
          {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 border-l-2 border-down/40 pl-3 text-[13px] text-down">{error}</p>
      ) : null}
    </Card>
  );
}

function ResolvedRow({ resolved }: { resolved: Resolved }) {
  const { suggestion, action, duplicate, linearIssueId } = resolved;
  const approved = action === 'approve';
  return (
    <Card className="flex flex-wrap items-center gap-2 px-5 py-3.5 text-[13px]">
      <span className={approved ? 'text-up' : 'text-ink-faint'} aria-hidden>
        {approved ? '✓' : '○'}
      </span>
      <span className="text-ink">“{suggestion.text}”</span>
      <span className="text-ink-muted">
        was {approved ? 'approved' : 'dismissed'}
        {approved
          ? duplicate
            ? ' · already tracked'
            : suggestion.kind === 'competitor'
              ? ' · now a tracked competitor'
              : ' · now tracked'
          : ''}
      </span>
      {linearIssueId ? (
        <span className="text-ink-muted">
          · pushed to Linear as <span className="font-mono text-[12px] text-ink">{linearIssueId}</span>
        </span>
      ) : null}
    </Card>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="px-4 pt-3.5 pb-1">
        <Overline>{title}</Overline>
      </div>
      <div className="px-4 pb-3.5">{children}</div>
    </Card>
  );
}

export default function SuggestionsPage() {
  const { data, error, loading, refresh } = useSuggestions();
  const [resolved, setResolved] = useState<Resolved[]>([]);

  const onResolved = useCallback((entry: Resolved) => {
    setResolved((prev) => [entry, ...prev]);
  }, []);

  const resolvedIds = useMemo(() => new Set(resolved.map((r) => r.suggestion.id)), [resolved]);
  const pending = useMemo(
    () => (data ?? []).filter((s) => !resolvedIds.has(s.id)),
    [data, resolvedIds]
  );

  const lastScan = useMemo(() => {
    const stamps = (data ?? []).map((s) => s.created_at).sort();
    return stamps[stamps.length - 1] ?? null;
  }, [data]);

  const projects = useMemo(() => {
    const names = new Set<string>();
    for (const suggestion of data ?? []) {
      const { project } = parseRationale(suggestion.rationale);
      if (project) names.add(project);
    }
    return [...names];
  }, [data]);

  return (
    <>
      <PageHeader
        title="Suggestions"
        subtitle="Drawn from the team's Linear roadmap. Nothing is tracked until you approve it."
      />

      <div className="grid grid-cols-1 gap-4 px-8 pb-12 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          {error ? (
            <Card>
              <ErrorState message={error} onRetry={refresh} />
            </Card>
          ) : loading ? (
            <>
              <Card className="px-5 py-4">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-3 h-5 w-2/3" />
                <Skeleton className="mt-3 h-12 w-full" />
                <Skeleton className="mt-4 h-8 w-64" />
              </Card>
              <Card className="px-5 py-4">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-3 h-5 w-1/2" />
                <Skeleton className="mt-3 h-12 w-full" />
                <Skeleton className="mt-4 h-8 w-64" />
              </Card>
            </>
          ) : pending.length === 0 ? (
            <Card className="px-5 py-10">
              <p className="text-sm font-medium">
                {resolved.length > 0 ? 'Everything has been reviewed.' : 'No pending suggestions.'}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                The weekly Linear scan proposes new queries and competitors as the roadmap moves.
              </p>
            </Card>
          ) : (
            pending.map((suggestion) => (
              <SuggestionCard key={suggestion.id} suggestion={suggestion} onResolved={onResolved} />
            ))
          )}

          {resolved.map((entry) => (
            <ResolvedRow key={entry.suggestion.id} resolved={entry} />
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <RailCard title="Last scan">
            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <>
                <p className="text-[17px] font-semibold">
                  {lastScan ? formatScanTime(lastScan) : 'No scan yet'}
                </p>
                <p className="mt-1 text-[13px] text-ink-muted">
                  {projects.length} project{projects.length === 1 ? '' : 's'} referenced ·{' '}
                  {pending.length} pending
                </p>
              </>
            )}
          </RailCard>

          <RailCard title="Linear projects referenced">
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : projects.length === 0 ? (
              <p className="py-1 text-[13px] text-ink-muted">
                No project was named in the current suggestions.
              </p>
            ) : (
              <ul>
                {projects.map((project) => (
                  <li
                    key={project}
                    className="border-b border-hairline py-2 text-[13px] last:border-0"
                  >
                    {project}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-ink-faint">
              Only projects that produced a suggestion appear here — the scan reads the roadmap
              read-only, and the dashboard never sees the full project list.
            </p>
          </RailCard>
        </div>
      </div>
    </>
  );
}
