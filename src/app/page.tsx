'use client';

import { useEffect, useMemo, useState } from 'react';
import { PROVIDER_LABEL } from '@/lib/labels';
import type { ProviderId } from '@/lib/types';
import { PageHeader, RangeSelect, Segmented } from './_components/filters';
import { Scoreboard } from './_components/scoreboard';
import { StatRow } from './_components/stat-cards';
import { Card, ErrorBanner, ErrorState } from './_components/ui';
import { VisibilityChart } from './_components/visibility-chart';
import { useOverview, type ProviderParam } from './_lib/fetcher';

const ALL_MODELS = { value: 'all' as ProviderParam, label: 'All models' };

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
];

export default function OverviewPage() {
  const [provider, setProvider] = useState<ProviderParam>('all');
  const [days, setDays] = useState(14);

  const overview = useOverview(days, provider);
  /**
   * Unfiltered companion fetch, read only for the shape of the dataset. Deriving
   * the model tabs from the *filtered* response would collapse the tab row to the
   * one provider already selected, with no way back.
   */
  const baseline = useOverview(days, 'all');

  /**
   * Last non-empty provider list. `useResource` clears `data` to null on every
   * key change, so reading the tabs straight off the response makes them vanish
   * and reappear on each filter change.
   */
  const [providersSeen, setProvidersSeen] = useState<ProviderId[]>([]);
  useEffect(() => {
    const next = baseline.data?.dataset.providersWithData;
    if (!next || next.length === 0) return;
    setProvidersSeen((prev) =>
      prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next
    );
  }, [baseline.data]);

  const providerTabs = useMemo(() => {
    const known = providersSeen.includes(provider as ProviderId)
      ? providersSeen
      : // Keep the active tab rendered even if it dropped out of the dataset,
        // so the control never shows an empty selection.
        [...providersSeen, ...(provider === 'all' ? [] : [provider as ProviderId])];
    return [ALL_MODELS, ...known.map((p) => ({ value: p as ProviderParam, label: PROVIDER_LABEL[p] ?? p }))];
  }, [providersSeen, provider]);

  const data = overview.data;
  const dataset = data?.dataset ?? null;
  /**
   * Where genuine daily collection starts, read from the dataset rather than
   * re-derived from run triggers here — synthetic runs are not live runs, and
   * the old filter (`trigger !== 'backfill'`) counted them as such.
   */
  const liveFrom = dataset?.firstLiveDate ?? undefined;
  const deltaGapDays = dataset?.deltaGapDays ?? null;
  const filterKey = `${provider}:${days}`;

  return (
    <>
      <PageHeader title="Overview">
        <Segmented
          label="Answer model"
          value={provider}
          options={providerTabs}
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
              dataset={dataset}
              liveFrom={liveFrom}
              loading={overview.loading}
            />
            <Scoreboard
              key={`scoreboard:${filterKey}`}
              rows={data?.scoreboard ?? []}
              deltaGapDays={deltaGapDays}
              loading={overview.loading}
            />
          </>
        )}
      </div>
    </>
  );
}
