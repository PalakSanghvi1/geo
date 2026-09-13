'use client';

import { useMemo, useRef, useState } from 'react';
import { providerLabel } from '@/lib/labels';
import { PageHeader, RangeSelect, Segmented } from './_components/filters';
import { Scoreboard } from './_components/scoreboard';
import { StatRow } from './_components/stat-cards';
import { Card, ErrorBanner, ErrorState } from './_components/ui';
import { VisibilityChart } from './_components/visibility-chart';
import { useOverview, useRuns, type ProviderParam } from './_lib/fetcher';

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
  const filterKey = `${provider}:${days}`;

  /**
   * Model tabs follow the data: a provider that collected nothing gets no tab,
   * so the filter can no longer offer a selection that renders an empty chart.
   * The last non-empty list is remembered because `data` is null while a filter
   * change is in flight, and collapsing the tabs mid-click would take away the
   * tab that was just pressed.
   */
  const seenProviders = useRef<string[]>([]);
  if (data && data.providersWithData.length > 0) seenProviders.current = data.providersWithData;
  const providerOptions: Array<{ value: ProviderParam; label: string }> = [
    { value: 'all', label: 'All models' },
    ...seenProviders.current.map((id) => ({
      value: id as ProviderParam,
      label: providerLabel(id),
    })),
  ];

  return (
    <>
      <PageHeader title="Overview">
        <Segmented
          label="Answer model"
          value={provider}
          options={providerOptions}
          onChange={setProvider}
        />
        <RangeSelect label="Date range" value={days} options={RANGES} onChange={setDays} />
      </PageHeader>

      <div className="flex flex-col gap-4 px-8 pb-12">
        {overview.error && data === null ? (
          <Card>
            <ErrorState message={overview.error} onRetry={overview.refresh} />
          </Card>
        ) : (
          <>
            {overview.error ? (
              <ErrorBanner message={overview.error} onRetry={overview.refresh} />
            ) : null}
            <StatRow data={data} />
            {/* Keyed on the filter so hidden series and expanded rows reset with it,
                rather than a line staying invisible after switching provider. The
                prefixes matter: two siblings sharing a key makes React duplicate them. */}
            <VisibilityChart
              key={`chart:${filterKey}`}
              series={data?.series ?? []}
              scoreboard={data?.scoreboard ?? []}
              liveFrom={liveFrom}
              loading={overview.loading}
            />
            <Scoreboard
              key={`scoreboard:${filterKey}`}
              rows={data?.scoreboard ?? []}
              deltaWindowDays={data?.deltaWindowDays ?? 0}
              loading={overview.loading}
            />
          </>
        )}
      </div>
    </>
  );
}
