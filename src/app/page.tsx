'use client';

import { useMemo, useState } from 'react';
import { PageHeader, RangeSelect, Segmented } from './_components/filters';
import { Scoreboard } from './_components/scoreboard';
import { StatRow } from './_components/stat-cards';
import { Badge, Card, ErrorState } from './_components/ui';
import { VisibilityChart } from './_components/visibility-chart';
import { USE_MOCK, useOverview, useRuns, type ProviderParam } from './_lib/fetcher';

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

export default function OverviewPage() {
  const [provider, setProvider] = useState<ProviderParam>('all');
  const [days, setDays] = useState(14);

  const overview = useOverview(days, provider);
  const runs = useRuns();

  /**
   * Backfilled runs carry simulated dates, so the chart marks where genuine
   * daily collection starts. Derived from run triggers rather than hardcoded —
   * the boundary moves on its own as live runs accumulate during the demo.
   */
  const liveFrom = useMemo(() => {
    const dates = (runs.data ?? [])
      .filter((run) => run.trigger !== 'backfill')
      .map((run) => run.run_date)
      .sort();
    return dates[0];
  }, [runs.data]);

  const data = overview.data;

  return (
    <>
      <PageHeader title="Overview">
        {USE_MOCK ? <Badge tone="warn">Mock data</Badge> : null}
        <Segmented
          label="Answer model"
          value={provider}
          options={PROVIDERS}
          onChange={setProvider}
        />
        <RangeSelect label="Date range" value={days} options={RANGES} onChange={setDays} />
      </PageHeader>

      <div className="flex flex-col gap-4 px-8 pb-12">
        {overview.error ? (
          <Card>
            <ErrorState message={overview.error} onRetry={overview.refresh} />
          </Card>
        ) : (
          <>
            <StatRow data={data} />
            <VisibilityChart
              series={data?.series ?? []}
              scoreboard={data?.scoreboard ?? []}
              liveFrom={liveFrom}
              loading={overview.loading}
            />
            <Scoreboard rows={data?.scoreboard ?? []} loading={overview.loading} />
          </>
        )}
      </div>
    </>
  );
}
