import type { ReactNode } from 'react';
import { deltaWindowPhrase } from '@/lib/labels';
import type { OverviewResponse } from '@/lib/types';
import { Card, Delta, Overline, Skeleton } from './ui';

export function StatCard({
  label,
  value,
  suffix,
  footer,
}: {
  label: string;
  value: ReactNode;
  /** Muted continuation of the headline number, e.g. the "/135" in "135/135". */
  suffix?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Card className="px-5 py-4">
      <Overline>{label}</Overline>
      <div className="numeric mt-2 text-[30px] leading-none font-semibold tracking-[-0.02em]">
        {value}
        {suffix ? <span className="text-ink-muted">{suffix}</span> : null}
      </div>
      <div className="mt-2.5 text-[13px] text-ink-muted">{footer}</div>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card className="px-5 py-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3 h-7 w-24" />
      <Skeleton className="mt-3 h-3 w-32" />
    </Card>
  );
}

function sentimentLabel(value: number): string {
  if (value >= 40) return 'mostly positive mentions';
  if (value >= 10) return 'leaning positive';
  if (value > -10) return 'largely neutral';
  if (value > -40) return 'leaning negative';
  return 'mostly negative mentions';
}

export function StatRow({ data }: { data: OverviewResponse | null }) {
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
    );
  }

  const self = data.self;
  if (!self) {
    // Two different conditions used to share one message. An empty window is the
    // ordinary case when a filter selects a provider that collected nothing, and
    // telling that reader to seed the brands table sends them after a problem that
    // does not exist.
    return (
      <Card className="px-5 py-6 text-sm text-ink-muted">
        {data.dataset.runDays === 0
          ? 'No answers in this window — try a different model or date range.'
          : 'No brand is marked as self yet — seed the brands table to populate the headline stats.'}
      </Card>
    );
  }

  const rank = data.scoreboard.findIndex((row) => row.isSelf) + 1;
  const { ok, total } = self.coverageToday;
  const failed = total - ok;
  // The window the delta actually averaged over, which is not always seven days —
  // and whether anything in it was measured.
  const deltaDays = data.dataset.deltaWindowDays;
  const deltaPhrase = deltaWindowPhrase(deltaDays, data.dataset.deltaBaselineIsIllustrative);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Visibility"
        value={`${self.visibility.toFixed(0)}%`}
        footer={
          // With no prior day the phrase stands alone: a signed change against
          // nothing is not a change worth printing.
          deltaDays <= 0 ? (
            deltaPhrase
          ) : (
            <>
              <Delta value={self.delta7} suffix=" pts" /> {deltaPhrase}
            </>
          )
        }
      />
      <StatCard
        label="Avg position"
        value={self.avgPosition === null ? '—' : self.avgPosition.toFixed(1)}
        footer={
          rank > 0
            ? `#${rank} of ${data.scoreboard.length} tracked brands`
            : 'not mentioned in this window'
        }
      />
      <StatCard
        label="Sentiment"
        value={`${self.sentiment > 0 ? '+' : ''}${Math.round(self.sentiment)}`}
        footer={sentimentLabel(self.sentiment)}
      />
      <StatCard
        label="Coverage today"
        value={ok}
        suffix={`/${total}`}
        footer={
          total === 0
            ? 'no answers collected yet'
            : failed === 0
              ? 'all answers collected'
              : `${failed} call${failed === 1 ? '' : 's'} failed — metrics use the rest`
        }
      />
    </div>
  );
}
