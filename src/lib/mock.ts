/**
 * Mock data for the dashboard (Workstream B).
 *
 * Workstream A's API routes land at Checkpoint 2; until then the UI runs on
 * this module so layout, empty states and chart behaviour can be built and
 * reviewed against realistic shapes. Every export matches the frozen response
 * types in `./types` exactly — if a field here does not exist there, the mock
 * is wrong, not the contract.
 *
 * Mock mode is opt-in via NEXT_PUBLIC_USE_MOCK=1 (see src/app/_lib/fetcher.ts)
 * and the header shows a MOCK DATA badge while it is on, so a build on the VPS
 * can never quietly present invented numbers as measurements.
 */
import type { CoveragePoint, OverviewResponse, Run, ScoreboardRow, SeriesPoint } from './types';

/** Park–Miller LCG: the same day always renders the same mock numbers. */
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Oldest first, matching `recentDates()` in src/lib/metrics.ts. */
export function mockDates(days = 14): string[] {
  return Array.from({ length: days }, (_, i) => isoDaysAgo(days - 1 - i));
}

/**
 * Where backfilled history stops and live runs begin. Real data derives this
 * from `runs.trigger`; the chart draws a dotted boundary there so nobody reads
 * simulated run-dates as seven days of genuine daily tracking.
 */
export function mockLiveFrom(): string {
  return isoDaysAgo(6);
}

interface MockBrand {
  brand: string;
  isSelf: boolean;
  /** Visibility at the start of the window, and today. */
  start: number;
  end: number;
  delta7: number;
  avgPosition: number;
  sentiment: number;
}

/** Ordered by today's visibility, which is how the scoreboard sorts. */
const BRANDS: MockBrand[] = [
  { brand: 'LangSmith', isSelf: false, start: 56, end: 54, delta7: -1.2, avgPosition: 1.8, sentiment: 48 },
  { brand: 'Langfuse', isSelf: false, start: 42, end: 43, delta7: 0.8, avgPosition: 2.6, sentiment: 55 },
  { brand: 'Lemma', isSelf: true, start: 27, end: 41, delta7: 4.2, avgPosition: 2.3, sentiment: 62 },
  { brand: 'Braintrust', isSelf: false, start: 33, end: 32, delta7: -0.4, avgPosition: 3.1, sentiment: 41 },
  { brand: 'Arize', isSelf: false, start: 25, end: 27, delta7: 1.1, avgPosition: 3.4, sentiment: 38 },
  { brand: 'Datadog', isSelf: false, start: 27, end: 24, delta7: -2.0, avgPosition: 2.9, sentiment: 22 },
  { brand: 'Raindrop', isSelf: false, start: 20, end: 22, delta7: 0.6, avgPosition: 3.8, sentiment: 44 },
  { brand: 'Helicone', isSelf: false, start: 19, end: 18, delta7: -0.5, avgPosition: 4.2, sentiment: 33 },
  { brand: 'Weights & Biases Weave', isSelf: false, start: 14, end: 15, delta7: 0.3, avgPosition: 4.6, sentiment: 29 },
  { brand: 'Galileo', isSelf: false, start: 12, end: 11, delta7: -0.7, avgPosition: 5.1, sentiment: 18 },
];

/** Providers see the category differently; used for the provider filter. */
const PROVIDER_BIAS: Record<string, number> = {
  all: 1,
  anthropic: 1.12,
  openai: 0.94,
  gemini: 0.88,
};

export function mockOverview(days = 14, provider = 'all'): OverviewResponse {
  const dates = mockDates(days);
  const bias = PROVIDER_BIAS[provider] ?? 1;
  const last = dates.length - 1;

  const series: SeriesPoint[] = [];
  for (const [i, b] of BRANDS.entries()) {
    const rand = seeded((i + 1) * 7919);
    for (const [d, date] of dates.entries()) {
      const trend = b.start + ((b.end - b.start) * d) / Math.max(1, last);
      // Today is pinned to the scoreboard value so the chart and the table agree.
      const value = d === last ? b.end * bias : (trend + (rand() - 0.5) * 3.6) * bias;
      series.push({ date, brand: b.brand, visibility: round1(Math.max(0, value)) });
    }
  }

  const scoreboard: ScoreboardRow[] = BRANDS.map((b) => ({
    brand: b.brand,
    isSelf: b.isSelf,
    visibility: round1(b.end * bias),
    delta7: b.delta7,
    avgPosition: b.avgPosition,
    sentiment: b.sentiment,
  })).sort((a, b) => b.visibility - a.visibility);

  // One backfill day degraded — the partial-run badge needs something to show.
  const partialDay = dates[Math.max(0, dates.length - 4)];
  const coverage: CoveragePoint[] = dates.map((date) => ({
    date,
    okPct: date === partialDay ? 95.6 : 100,
  }));

  const self = scoreboard.find((r) => r.isSelf) ?? null;

  return {
    series,
    scoreboard,
    coverage,
    self: self
      ? {
          brand: self.brand,
          visibility: self.visibility,
          delta7: self.delta7,
          avgPosition: self.avgPosition,
          sentiment: self.sentiment,
          coverageToday: { ok: 135, total: 135 },
        }
      : null,
  };
}

export function mockRuns(days = 14): Run[] {
  const dates = mockDates(days);
  const liveFrom = mockLiveFrom();

  const runs: Run[] = dates.map((run_date, i) => {
    const rand = seeded((i + 1) * 104729);
    const backfilled = run_date < liveFrom;
    const partial = i === dates.length - 4;
    const failed = partial ? 6 : 0;
    return {
      id: i + 1,
      run_date,
      trigger: backfilled ? 'backfill' : 'scheduled',
      status: partial ? 'partial' : 'complete',
      started_at: `${run_date} 06:00:00`,
      finished_at: `${run_date} 06:0${Math.floor(rand() * 3) + 7}:${Math.floor(rand() * 50) + 10}`,
      total_calls: 135,
      ok_calls: 135 - failed,
      failed_calls: failed,
    };
  });

  // The in-flight run at the top of the Runs page — what "Run now" produces.
  runs.push({
    id: dates.length + 1,
    run_date: dates[dates.length - 1],
    trigger: 'manual',
    status: 'running',
    started_at: `${dates[dates.length - 1]} 09:41:12`,
    finished_at: null,
    total_calls: 135,
    ok_calls: 87,
    failed_calls: 2,
  });

  return runs.reverse();
}
