/**
 * The single source of truth for every number the product reports.
 *
 * Dashboard, Slack digest and Notion report MUST all read from here — if these
 * definitions live in more than one place they will drift and the demo will show
 * two different visibility numbers on the same screen.
 *
 * Definitions (BUILD_PLAN section 3):
 *   Visibility(brand, day) = ok answers that day mentioning brand / all ok answers that day * 100
 *   Position(brand, day)   = AVG(position) over that brand's mentions that day (lower is better)
 *   Sentiment(brand, day)  = AVG(sentiment) * 100, so -100..+100
 *   delta7                 = latest day's visibility - mean of the 7 days before it
 *
 * Runs that only partly succeeded are handled by computing over ok answers only;
 * `coverage` reports what fraction of attempted calls landed so the UI can badge it.
 */
import { all, get, parseJson } from './db';
import { ALERT_THRESHOLD_PTS, NEW_COMPETITOR_MIN_ANSWERS, SEED_BRANDS } from './config';
import { deltaComparisonPhrase } from './labels';
import { measuredRunsClause } from './provenance';
import type {
  Citation,
  CoveragePoint,
  DatasetShape,
  OverviewResponse,
  ProviderId,
  ScoreboardRow,
  SeriesPoint,
  SourceRow,
} from './types';

export type ProviderFilter = ProviderId | 'all';

function providerClause(provider: ProviderFilter, params: unknown[]): string {
  if (provider === 'all') return '';
  params.push(provider);
  return ' AND a.provider = ?';
}

/**
 * The most recent N run dates that have at least one scored answer, oldest first.
 *
 * The provider filter belongs here, not only downstream. Picking the window from
 * every provider's dates and then filtering the counts gives a day whose total is
 * zero, and `visibilityOn` reports zero for that — so a provider with no answers
 * rendered a full chart of flat 0% lines and a scoreboard of 0% rows rather than an
 * empty state. Selecting the dates the provider actually has makes "nothing here"
 * an empty window, which every caller already handles.
 */
export function recentDates(days: number, provider: ProviderFilter = 'all'): string[] {
  const params: unknown[] = [];
  const clause = providerClause(provider, params);
  const rows = all<{ run_date: string }>(
    `SELECT DISTINCT r.run_date
       FROM runs r
       JOIN answers a ON a.run_id = r.id
      WHERE a.status = 'ok'${clause}
      ORDER BY r.run_date DESC
      LIMIT ?`,
    [...params, days]
  );
  return rows.map((r) => r.run_date).reverse();
}

interface DayTotals {
  date: string;
  total: number;
  attempted: number;
}

function dailyTotals(dates: string[], provider: ProviderFilter): Map<string, DayTotals> {
  if (dates.length === 0) return new Map();
  const placeholders = dates.map(() => '?').join(',');
  const params: unknown[] = [...dates];
  const clause = providerClause(provider, params);

  const rows = all<{ date: string; total: number; attempted: number }>(
    `SELECT r.run_date AS date,
            SUM(CASE WHEN a.status = 'ok' THEN 1 ELSE 0 END) AS total,
            COUNT(a.id) AS attempted
       FROM answers a
       JOIN runs r ON r.id = a.run_id
      WHERE r.run_date IN (${placeholders})${clause}
      GROUP BY r.run_date`,
    params
  );

  const map = new Map<string, DayTotals>();
  for (const d of dates) map.set(d, { date: d, total: 0, attempted: 0 });
  for (const r of rows) map.set(r.date, { date: r.date, total: r.total, attempted: r.attempted });
  return map;
}

interface BrandDay {
  date: string;
  brand: string;
  isSelf: boolean;
  hits: number;
  avgPosition: number | null;
  avgSentiment: number | null;
}

function brandDays(dates: string[], provider: ProviderFilter): BrandDay[] {
  if (dates.length === 0) return [];
  const placeholders = dates.map(() => '?').join(',');
  const params: unknown[] = [...dates];
  const clause = providerClause(provider, params);

  return all<{
    date: string;
    brand: string;
    is_self: number;
    hits: number;
    avg_position: number | null;
    avg_sentiment: number | null;
  }>(
    `SELECT r.run_date AS date,
            b.name AS brand,
            b.is_self AS is_self,
            COUNT(DISTINCT a.id) AS hits,
            AVG(m.position) AS avg_position,
            AVG(m.sentiment) AS avg_sentiment
       FROM mentions m
       JOIN answers a ON a.id = m.answer_id
       JOIN runs r ON r.id = a.run_id
       JOIN brands b ON b.id = m.brand_id
      WHERE a.status = 'ok' AND r.run_date IN (${placeholders})${clause}
      GROUP BY r.run_date, b.id`,
    params
  ).map((r) => ({
    date: r.date,
    brand: r.brand,
    isSelf: r.is_self === 1,
    hits: r.hits,
    avgPosition: r.avg_position,
    avgSentiment: r.avg_sentiment,
  }));
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Whole days between two `YYYY-MM-DD` dates. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Dates in the window backed by a real provider answer, honouring the provider filter.
 *
 * Counted from ANSWERS, not runs. A run-based count would describe a dataset the
 * screen is not showing: with Gemini selected every plotted point is fabricated, yet
 * the run rows for the days Claude and GPT collected would still be counted.
 */
function measuredDatesIn(dates: string[], provider: ProviderFilter): Set<string> {
  if (dates.length === 0) return new Set();
  const placeholders = dates.map(() => '?').join(',');
  const params: unknown[] = [...dates];
  const clause = providerClause(provider, params);
  return new Set(
    all<{ run_date: string }>(
      `SELECT DISTINCT r.run_date AS run_date
         FROM answers a JOIN runs r ON r.id = a.run_id
        WHERE a.status = 'ok' AND ${measuredRunsClause()}
          AND r.run_date IN (${placeholders})${clause}`,
      params
    ).map((r) => r.run_date)
  );
}

export function getOverview(days = 14, provider: ProviderFilter = 'all'): OverviewResponse {
  const dates = recentDates(days, provider);

  // Nothing was collected under this filter. Returning a scoreboard here would still
  // carry the self brand at 0% — `brandNames` always includes it — and the stat cards
  // would read "Visibility 0%" for a provider that was never asked. 0% is a
  // measurement; the honest answer is that there isn't one.
  if (dates.length === 0) {
    return {
      series: [],
      scoreboard: [],
      coverage: [],
      dataset: describeDataset([], new Set(), provider),
      self: null,
    };
  }

  const totals = dailyTotals(dates, provider);
  const rows = brandDays(dates, provider);
  const measuredDates = measuredDatesIn(dates, provider);

  // Every brand that has ever been mentioned in the window, plus the self brand.
  const brandNames = new Set<string>(rows.map((r) => r.brand));
  const selfBrand = get<{ name: string }>(`SELECT name FROM brands WHERE is_self = 1 LIMIT 1`);
  if (selfBrand) brandNames.add(selfBrand.name);

  const byBrandDate = new Map<string, BrandDay>();
  for (const r of rows) byBrandDate.set(`${r.brand}|${r.date}`, r);

  const visibilityOn = (brand: string, date: string): number => {
    const total = totals.get(date)?.total ?? 0;
    if (total === 0) return 0;
    const hits = byBrandDate.get(`${brand}|${date}`)?.hits ?? 0;
    return (hits / total) * 100;
  };

  const series: SeriesPoint[] = [];
  for (const brand of brandNames) {
    for (const date of dates) {
      series.push({ date, brand, visibility: round(visibilityOn(brand, date)) });
    }
  }

  /*
   * Headline basis. Every figure outside the chart — the stat cards, and every
   * scoreboard column — is computed on ONE day, and that day is the newest
   * MEASURED day, not the newest day.
   *
   * They diverge whenever illustrative filler is more recent than the last real
   * collection, which is the ordinary state between runs. Reading the newest day
   * then puts a generated number under the word "Visibility". A date four days
   * back that a model actually answered is worth more than today's invention, so
   * the basis shifts and `dataset.headlineDate` carries the date for the UI to show.
   */
  const measured = dates.filter((d) => measuredDates.has(d));
  const headlineDate = measured.at(-1) ?? null;
  const newestDate = dates[dates.length - 1] ?? null;
  const headlineIsCurrent = headlineDate !== null && headlineDate === newestDate;

  /*
   * Delta basis: the measured day before the headline day, and only while the
   * headline is current.
   *
   * Two separate reasons, both fatal on their own. A delta between two stale days
   * decorates a number the card has already labelled out of date. And the gap
   * between measured days is whatever collection managed — four days here, three
   * after the next run — never the seven the old "vs the 7-day average" claimed,
   * and never a mean over days that were mostly generated.
   *
   * Both conditions clear themselves: collect today and the headline is current
   * again and the delta returns, labelled with the real gap.
   */
  const previousMeasured = headlineIsCurrent ? (measured.at(-2) ?? null) : null;
  const deltaGapDays =
    previousMeasured && headlineDate ? daysBetween(previousMeasured, headlineDate) : null;

  const scoreboard: ScoreboardRow[] = [...brandNames]
    .map((brand) => {
      const headlineRow = headlineDate ? byBrandDate.get(`${brand}|${headlineDate}`) : undefined;
      const visibility = headlineDate ? round(visibilityOn(brand, headlineDate)) : 0;

      // Fall back to the whole window when the headline day has no mention of this brand,
      // so the table still shows a meaningful position/sentiment instead of a dash.
      const windowRows = rows.filter((r) => r.brand === brand);
      const posSource = headlineRow?.avgPosition ?? avg(windowRows.map((r) => r.avgPosition));
      const sentSource = headlineRow?.avgSentiment ?? avg(windowRows.map((r) => r.avgSentiment));

      return {
        brand,
        isSelf: headlineRow?.isSelf ?? windowRows[0]?.isSelf ?? brand === selfBrand?.name,
        visibility,
        // 0 when suppressed; the UI reads `deltaComparisonDate` to know not to render it.
        delta7:
          previousMeasured && headlineDate
            ? round(visibilityOn(brand, headlineDate) - visibilityOn(brand, previousMeasured))
            : 0,
        avgPosition: posSource === null ? null : round(posSource),
        sentiment: sentSource === null ? 0 : Math.round(sentSource * 100),
      };
    })
    .sort((a, b) => b.visibility - a.visibility);

  const coverage: CoveragePoint[] = dates.map((date) => {
    const t = totals.get(date);
    const attempted = t?.attempted ?? 0;
    return { date, okPct: attempted === 0 ? 0 : round((t!.total / attempted) * 100) };
  });

  const selfRow = scoreboard.find((r) => r.isSelf) ?? null;
  // Coverage belongs to the day the headline is read from, not to whatever is newest.
  const headlineTotals = headlineDate ? totals.get(headlineDate) : undefined;

  return {
    series,
    scoreboard,
    coverage,
    dataset: describeDataset(dates, measuredDates, provider, {
      headlineDate,
      headlineIsCurrent,
      deltaComparisonDate: previousMeasured,
      deltaGapDays,
    }),
    self: selfRow
      ? {
          brand: selfRow.brand,
          visibility: selfRow.visibility,
          delta7: selfRow.delta7,
          avgPosition: selfRow.avgPosition,
          sentiment: selfRow.sentiment,
          coverageToday: {
            ok: headlineTotals?.total ?? 0,
            total: headlineTotals?.attempted ?? 0,
          },
        }
      : null,
  };
}

/** The day each headline figure is read from, and what the delta compares against. */
interface HeadlineBasis {
  headlineDate: string | null;
  headlineIsCurrent: boolean;
  deltaComparisonDate: string | null;
  deltaGapDays: number | null;
}

/**
 * Describe the dataset so the UI can state what it has.
 *
 * Provenance comes from `runs.trigger` through `src/lib/provenance.ts`: `synthetic`
 * is invented, everything else is a real answer. A date counts as illustrative only
 * when it has NO measured run, so a real run landing on a filled date reclassifies
 * that day — which is exactly what should happen as collection replaces filler.
 */
function describeDataset(
  dates: string[],
  measuredDates: Set<string>,
  provider: ProviderFilter,
  basis: HeadlineBasis = {
    headlineDate: null,
    headlineIsCurrent: false,
    deltaComparisonDate: null,
    deltaGapDays: null,
  }
): DatasetShape {
  if (dates.length === 0) {
    return {
      runDays: 0,
      ...basis,
      providersWithData: [],
      providersWithMeasuredData: [],
      measuredDays: 0,
      illustrativeDays: 0,
      firstLiveDate: null,
    };
  }

  const placeholders = dates.map(() => '?').join(',');
  const measuredDays = measuredDates.size;

  // Tabs are built from this, so it deliberately ignores the current filter —
  // otherwise selecting one provider would collapse the tab row to that provider.
  const providersWithData = all<{ provider: string }>(
    `SELECT DISTINCT a.provider AS provider
       FROM answers a JOIN runs r ON r.id = a.run_id
      WHERE a.status = 'ok' AND r.run_date IN (${placeholders})`,
    dates
  ).map((r) => r.provider as ProviderId);

  const realProviderParams: unknown[] = [...dates];
  const realProviderClause = providerClause(provider, realProviderParams);
  const providersWithMeasuredData = all<{ provider: string }>(
    `SELECT DISTINCT a.provider AS provider
       FROM answers a JOIN runs r ON r.id = a.run_id
      WHERE a.status = 'ok' AND ${measuredRunsClause()}
        AND r.run_date IN (${placeholders})${realProviderClause}`,
    realProviderParams
  ).map((r) => r.provider as ProviderId);

  // Pin the order. DISTINCT returns rows in whatever order the planner produces, and a
  // caption that says "GPT and Claude" on one render and "Claude and GPT" on the next
  // looks like the data moved when only the query plan did.
  const ORDER: ProviderId[] = ['anthropic', 'openai', 'gemini'];
  const byCanonical = (a: ProviderId, b: ProviderId) => ORDER.indexOf(a) - ORDER.indexOf(b);
  providersWithData.sort(byCanonical);
  providersWithMeasuredData.sort(byCanonical);

  // Narrower than `measuredRunsClause()` on purpose: this is the boundary of genuine
  // DAILY collection, so a backfilled date — real answers, simulated date — is not it.
  const live = get<{ run_date: string }>(
    `SELECT MIN(run_date) AS run_date FROM runs r
      WHERE r.run_date IN (${placeholders}) AND r.trigger IN ('scheduled', 'manual')`,
    dates
  );

  return {
    runDays: dates.length,
    ...basis,
    providersWithData,
    providersWithMeasuredData,
    measuredDays,
    illustrativeDays: dates.length - measuredDays,
    firstLiveDate: live?.run_date ?? null,
  };
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

function domainOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

export function getSources(days = 14, provider: ProviderFilter = 'all'): SourceRow[] {
  const dates = recentDates(days, provider);
  if (dates.length === 0) return [];
  const placeholders = dates.map(() => '?').join(',');
  const params: unknown[] = [...dates];
  const clause = providerClause(provider, params);

  const rows = all<{ citations: string }>(
    `SELECT a.citations AS citations
       FROM answers a
       JOIN runs r ON r.id = a.run_id
      WHERE a.status = 'ok' AND r.run_date IN (${placeholders})${clause}`,
    params
  );

  // Competitor-owned detection needs the brands' real domains, not just their names:
  // LangSmith's docs live on smith.langchain.com, which contains nothing derivable
  // from "LangSmith". Name matching stays as a fallback for brands whose domain is
  // their name (langfuse.com, arize.com).
  const competitorDomains = SEED_BRANDS.filter((b) => !b.isSelf).flatMap((b) =>
    (b.domains ?? []).map((d) => d.toLowerCase())
  );
  const brands = all<{ name: string }>(`SELECT name FROM brands WHERE is_self = 0`).map((b) =>
    b.name.toLowerCase().replace(/[^a-z0-9]/g, '')
  );

  const byDomain = new Map<string, { count: number; urls: Map<string, number> }>();
  for (const row of rows) {
    for (const c of parseJson<Citation[]>(row.citations, [])) {
      const domain = domainOf(c.url);
      if (!domain) continue;
      const entry = byDomain.get(domain) ?? { count: 0, urls: new Map<string, number>() };
      entry.count += 1;
      entry.urls.set(c.url, (entry.urls.get(c.url) ?? 0) + 1);
      byDomain.set(domain, entry);
    }
  }

  return [...byDomain.entries()]
    .map(([domain, entry]) => {
      const flat = domain.replace(/[^a-z0-9]/g, '');
      // Suffix match so any subdomain of a competitor domain counts too.
      const ownedByDomain = competitorDomains.some(
        (d) => domain === d || domain.endsWith(`.${d}`)
      );
      return {
        domain,
        citationCount: entry.count,
        isCompetitorOwned: ownedByDomain || brands.some((b) => b.length > 3 && flat.includes(b)),
        urls: [...entry.urls.entries()]
          .map(([url, count]) => ({ url, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
      };
    })
    .sort((a, b) => b.citationCount - a.citationCount);
}

/* ------------------------------------------------------------------ */
/* Alerting signals (Slack digest + dashboard banners)                 */
/* ------------------------------------------------------------------ */

export interface DigestSignal {
  kind: 'delta' | 'overtake' | 'new_competitor' | 'provider_divergence';
  text: string;
}

/**
 * Notable events for a given day, most important first. Kept here (not in the
 * Slack module) so the dashboard and the Notion report can show the same list.
 */
export function getSignals(days = 14): DigestSignal[] {
  const overview = getOverview(days, 'all');
  const signals: DigestSignal[] = [];
  const self = overview.self;
  if (!self) return signals;

  // No comparable measured day means there is no movement to alert on. Silence is
  // the right signal: firing on a change computed against filler would train the
  // channel to ignore the alert that matters.
  const deltaPhrase = deltaComparisonPhrase(overview.dataset.deltaGapDays);
  if (deltaPhrase && Math.abs(self.delta7) >= ALERT_THRESHOLD_PTS) {
    const dir = self.delta7 > 0 ? 'up' : 'down';
    signals.push({
      kind: 'delta',
      text:
        `${self.brand} visibility is ${dir} ${Math.abs(self.delta7).toFixed(1)} pts ` +
        `${deltaPhrase} (now ${self.visibility.toFixed(1)}%).`,
    });
  }

  const ranked = overview.scoreboard;
  const selfIndex = ranked.findIndex((r) => r.isSelf);
  if (selfIndex > 0) {
    const ahead = ranked[selfIndex - 1];
    const gap = round(ahead.visibility - self.visibility);
    if (gap <= 3) {
      signals.push({
        kind: 'overtake',
        // Only the current gap is computed here. "Closest it has been this window"
        // would be a claim about history that nothing in this function measures.
        text:
          gap === 0
            ? `${ahead.brand} is level with you on ${overview.dataset.headlineDate}.`
            : `${ahead.brand} is ${gap.toFixed(1)} pts ahead of you on ${overview.dataset.headlineDate}.`,
      });
    }
  }
  if (selfIndex >= 0 && selfIndex + 1 < ranked.length) {
    const behind = ranked[selfIndex + 1];
    if (round(self.visibility - behind.visibility) <= 3) {
      signals.push({
        kind: 'overtake',
        // A zero gap read as "0.0 pts behind you", which is a tie described as a lead.
        text:
          round(self.visibility - behind.visibility) === 0
            ? `${behind.brand} is level with you on ${overview.dataset.headlineDate}.`
            : `${behind.brand} is ${round(self.visibility - behind.visibility).toFixed(1)} pts behind you on ${overview.dataset.headlineDate}.`,
      });
    }
  }

  // Untracked brands the extractor kept seeing.
  const dates = recentDates(Math.min(days, 3));
  if (dates.length > 0) {
    const placeholders = dates.map(() => '?').join(',');
    const rows = all<{ other_brands: string }>(
      `SELECT a.other_brands
         FROM answers a JOIN runs r ON r.id = a.run_id
        WHERE a.status = 'ok' AND r.run_date IN (${placeholders})`,
      dates
    );
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const name of new Set(parseJson<string[]>(r.other_brands, []))) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    for (const [name, count] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)) {
      if (count >= NEW_COMPETITOR_MIN_ANSWERS) {
        signals.push({
          kind: 'new_competitor',
          text: `"${name}" appeared in ${count} recent answers but isn't tracked yet.`,
        });
      }
    }
  }

  // Does one provider see us very differently from another?
  const perProvider = (['anthropic', 'openai', 'gemini'] as ProviderId[])
    .map((p) => ({ provider: p, v: getOverview(1, p).self?.visibility ?? 0 }))
    .filter((p) => p.v > 0);
  if (perProvider.length >= 2) {
    const high = perProvider.reduce((a, b) => (a.v >= b.v ? a : b));
    const low = perProvider.reduce((a, b) => (a.v <= b.v ? a : b));
    if (high.v - low.v >= 15) {
      signals.push({
        kind: 'provider_divergence',
        text: `${labelFor(high.provider)} mentions you ${high.v.toFixed(0)}% of the time vs ${labelFor(low.provider)} at ${low.v.toFixed(0)}%.`,
      });
    }
  }

  return signals;
}

function labelFor(p: ProviderId): string {
  return p === 'anthropic' ? 'Claude' : p === 'openai' ? 'GPT' : 'Gemini';
}
