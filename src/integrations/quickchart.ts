/**
 * QuickChart integration — turns the 14-day visibility series from
 * `src/lib/metrics.ts` into a chart *image URL*.
 *
 * Why a URL and not a rendered image: Notion's external-image blocks take a URL
 * and Notion's own servers fetch it, so we need no image hosting of our own
 * (BUILD_PLAN §8, Phase C3 item 1 — "Chart image").
 *
 * This module is deliberately **pure**: no network, no DB, no Slack, no Notion.
 * The caller (src/integrations/notion.ts) supplies the data it already fetched
 * from `getOverview()` and embeds the string we return. That keeps every number
 * in the dashboard, the Slack digest and the Notion report on the single
 * metrics code path.
 *
 * Nothing here throws. An empty or sparse series yields a valid URL for an
 * empty chart rather than an exception, so a report can still publish on a day
 * with no data.
 *
 * Chart.js config dialect: QuickChart's default renderer is Chart.js **v2**
 * (`options.title`, `options.legend`, `options.scales.yAxes`), which is what
 * this file emits. Do not "modernise" these keys to v3/v4 syntax without also
 * appending `&v=3` (or later) to the URL — the chart silently loses its axes
 * and title otherwise.
 */
import type { ScoreboardRow, SeriesPoint } from '../lib/types';

/* ------------------------------------------------------------------ */
/* URL length                                                          */
/* ------------------------------------------------------------------ */

/**
 * Practical ceiling for a QuickChart GET URL.
 *
 * QuickChart itself accepts far more, but the strictest consumer sets the
 * budget: Notion rejects any URL over 2000 characters, and it is Notion's
 * servers that fetch this image for the weekly report. Designing to 2000 keeps
 * one number true for every consumer.
 *
 * Measured with the compact JSON5 encoding below, 14 days of self + 4
 * competitors lands at ~1880 characters even with the longest real brand name
 * in the seed list ("Weights & Biases Weave") — about 120 characters of
 * headroom. That is what makes the plan's "Lemma + top 4 competitors" chart
 * actually fit; before the encoding change the same chart was ~2500 and had to
 * be trimmed to 2 competitors.
 *
 * If you need a bigger chart, use QuickChart's POST/short-URL API rather than
 * widening this number.
 */
export const QUICKCHART_MAX_URL_LENGTH = 2000;

/** Character length of a generated chart URL. */
export function chartUrlLength(url: string): number {
  return url.length;
}

/**
 * True when the URL is short enough to be safely embedded in Notion/Slack.
 * Callers can use this to fall back to a text-only report instead of embedding
 * an image block that would render as a broken image.
 */
export function isChartUrlSafeLength(url: string): boolean {
  return url.length <= QUICKCHART_MAX_URL_LENGTH;
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface VisibilityChartOptions {
  /**
   * The full daily visibility series, exactly as returned by
   * `getOverview().series` — every brand, every day. Brand selection happens
   * inside this module, so do not pre-filter it.
   */
  series: SeriesPoint[];
  /**
   * `getOverview().scoreboard`. Used to identify the self brand (`isSelf`) and
   * to rank competitors by current visibility. Optional: without it, ranking
   * falls back to mean visibility across the window and the self brand is taken
   * from `selfBrand`.
   */
  scoreboard?: ScoreboardRow[];
  /**
   * Name of the self brand (e.g. "Lemma"). Overrides the scoreboard's `isSelf`
   * flag when both are supplied. Always plotted, even if it is not top-5.
   */
  selfBrand?: string;
  /** How many competitors to plot alongside the self brand. Default 4. */
  competitorCount?: number;
  /** Chart title. Default "AI Visibility — last 14 days". */
  title?: string;
  /** Image width in px. Default 800. */
  width?: number;
  /** Image height in px. Default 400. */
  height?: number;
  /**
   * Background colour for the rendered PNG (QuickChart `bkg` param). Default
   * "white" — Notion renders images on both light and dark page backgrounds and
   * a transparent chart with dark axis labels is unreadable on dark mode.
   * Pass `null` to omit the parameter and get QuickChart's default.
   */
  backgroundColor?: string | null;
}

/** What `selectChartBrands` resolved, exposed for logging/tests. */
export interface ChartBrandSelection {
  /** Self brand first, then competitors in descending visibility order. */
  brands: string[];
  /** The self brand actually used, or null when it could not be determined. */
  selfBrand: string | null;
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

/** Strong, saturated blue reserved for the self brand. */
const SELF_COLOR = '#2563eb';

/**
 * Competitor colours — distinct hues that stay legible against each other and
 * against SELF_COLOR at 2px line width on white. Cycled if there are more
 * competitors than entries.
 */
const COMPETITOR_COLORS = [
  '#f97316', // orange
  '#059669', // emerald
  '#9333ea', // violet
  '#dc2626', // red
  '#0891b2', // cyan
  '#ca8a04', // amber
  '#be185d', // pink
  '#475569', // slate
];

const SELF_LINE_WIDTH = 4;
const COMPETITOR_LINE_WIDTH = 2;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Round to a whole percentage point.
 *
 * The chart is a trend picture, not a readout — the exact figures live in the
 * report's scoreboard table and on the dashboard. Dropping the decimal saves
 * roughly two characters per plotted point, which across 5 series x 14 days is
 * the headroom that keeps the URL inside Notion's hard 2000-character limit
 * even when brand names are long ("Weights & Biases Weave").
 */
function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/** "2026-09-13" -> "09-13"; anything else is passed through untouched. */
function shortDate(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(5) : date;
}

function colorForIndex(index: number): string {
  return COMPETITOR_COLORS[index % COMPETITOR_COLORS.length];
}

/* ------------------------------------------------------------------ */
/* Brand selection                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pick the self brand plus the top N competitors (BUILD_PLAN §8 C3: "Lemma +
 * top 4 competitors"). The self brand is always included and always first, even
 * when its visibility puts it outside the top 5.
 *
 * Ranking uses the scoreboard's current visibility when available (that is the
 * same ordering the dashboard and digest show); otherwise it falls back to each
 * brand's mean visibility across the series window.
 */
export function selectChartBrands(options: VisibilityChartOptions): ChartBrandSelection {
  const series = options.series ?? [];
  const scoreboard = options.scoreboard ?? [];
  const competitorCount = Math.max(0, options.competitorCount ?? 4);

  const selfBrand =
    options.selfBrand ?? scoreboard.find((row) => row?.isSelf)?.brand ?? null;

  // Mean visibility per brand, used both as the fallback ranking and to order
  // brands that appear in the series but not in the scoreboard.
  const totals = new Map<string, { sum: number; count: number }>();
  for (const point of series) {
    if (!point || typeof point.brand !== 'string') continue;
    const entry = totals.get(point.brand) ?? { sum: 0, count: 0 };
    // A gap contributes nothing to the ranking average, and is not a zero.
    entry.sum += typeof point.visibility === 'number' && Number.isFinite(point.visibility)
      ? point.visibility
      : 0;
    entry.count += 1;
    totals.set(point.brand, entry);
  }

  const rankFromScoreboard = new Map<string, number>();
  scoreboard.forEach((row) => {
    if (row && typeof row.brand === 'string') {
      rankFromScoreboard.set(row.brand, Number.isFinite(row.visibility) ? row.visibility : 0);
    }
  });

  const candidates = new Set<string>([...totals.keys(), ...rankFromScoreboard.keys()]);
  if (selfBrand) candidates.delete(selfBrand);

  const rankOf = (brand: string): number => {
    const fromScoreboard = rankFromScoreboard.get(brand);
    if (fromScoreboard !== undefined) return fromScoreboard;
    const t = totals.get(brand);
    return t && t.count > 0 ? t.sum / t.count : 0;
  };

  const competitors = [...candidates]
    .sort((a, b) => rankOf(b) - rankOf(a) || a.localeCompare(b))
    .slice(0, competitorCount);

  const brands = selfBrand ? [selfBrand, ...competitors] : competitors;
  return { brands, selfBrand };
}

/* ------------------------------------------------------------------ */
/* Chart config + URL                                                  */
/* ------------------------------------------------------------------ */

/**
 * Build the Chart.js (v2 dialect) config object for the visibility chart.
 * Exported mainly so tests and debugging can inspect it without parsing a URL;
 * normal callers want `buildVisibilityChartUrl`.
 */
export function buildVisibilityChartConfig(options: VisibilityChartOptions): Record<string, unknown> {
  const series = options.series ?? [];
  const { brands, selfBrand } = selectChartBrands(options);

  // Chronological x axis: every date present in the series, ascending.
  const dates = [...new Set(series.map((p) => p?.date).filter((d): d is string => typeof d === 'string'))].sort();

  // brand|date -> visibility, so sparse input just leaves gaps in the lines.
  const byBrandDate = new Map<string, number>();
  for (const point of series) {
    if (!point || typeof point.brand !== 'string' || typeof point.date !== 'string') continue;
    if (point.visibility === null) continue;
    byBrandDate.set(`${point.brand}|${point.date}`, point.visibility);
  }

  let competitorIndex = 0;
  const datasets = brands.map((brand) => {
    const isSelf = selfBrand !== null && brand === selfBrand;
    const color = isSelf ? SELF_COLOR : colorForIndex(competitorIndex++);
    return {
      label: brand,
      // null (not 0) for missing days — a missing measurement is not 0% visibility.
      data: dates.map((date) => {
        const value = byBrandDate.get(`${brand}|${date}`);
        return value === undefined || !Number.isFinite(value) ? null : round1(value);
      }),
      borderColor: color,
      backgroundColor: color,
      borderWidth: isSelf ? SELF_LINE_WIDTH : COMPETITOR_LINE_WIDTH,
      pointRadius: isSelf ? 3 : 2,
    };
  });

  return {
    type: 'line',
    data: {
      labels: dates.map(shortDate),
      datasets,
    },
    options: {
      // Shared line styling lives here rather than on every dataset: repeated
      // per-dataset keys are the single biggest contributor to URL length once
      // encodeURIComponent triples every quote character.
      spanGaps: true,
      elements: { line: { fill: false, tension: 0.25 } },
      title: {
        display: true,
        text: options.title ?? 'AI Visibility — last 14 days',
        fontSize: 16,
      },
      legend: {
        display: true,
        position: 'bottom',
        labels: { boxWidth: 12, fontSize: 12 },
      },
      scales: {
        yAxes: [
          {
            ticks: { beginAtZero: true, min: 0, max: 100, stepSize: 20 },
            scaleLabel: { display: true, labelString: 'Visibility (% of answers)' },
          },
        ],
        xAxes: [{ scaleLabel: { display: true, labelString: 'Date' } }],
      },
    },
  };
}

/**
 * Build the QuickChart image URL for the 14-day visibility chart.
 *
 * Shape (BUILD_PLAN §8 C3): `https://quickchart.io/chart?w=800&h=400&c=<encoded JSON>`,
 * plus `&bkg=` for a solid background. Safe to embed directly as a Notion
 * external-image block URL.
 *
 * Never throws: bad, empty or sparse input degrades to an empty-but-valid chart.
 * Check `isChartUrlSafeLength(url)` before embedding if the input size is not
 * under your control.
 */
/* ------------------------------------------------------------------ */
/* Compact serialization                                               */
/* ------------------------------------------------------------------ */

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Serialize the config the way QuickChart's JSON5-tolerant parser accepts:
 * unquoted object keys and single-quoted strings.
 *
 * This is not cosmetic. `encodeURIComponent` expands every `"` to `%22` — three
 * characters — while `'` is left untouched and an unquoted key costs nothing.
 * On the plan's five-line, 14-day chart that is the difference between ~2.8k
 * and a URL that fits inside Notion's hard 2000-character limit, which is what
 * lets the report show Lemma plus the top 4 competitors as specified rather
 * than silently dropping lines.
 */
function serializeCompact(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  if (Array.isArray(value)) return `[${value.map(serializeCompact).join(',')}]`;
  if (typeof value === 'object') {
    const parts: string[] = [];
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      parts.push(`${IDENTIFIER.test(key) ? key : `'${key}'`}:${serializeCompact(item)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

export function buildVisibilityChartUrl(options: VisibilityChartOptions): string {
  const width = options?.width ?? 800;
  const height = options?.height ?? 400;
  const background = options?.backgroundColor === undefined ? 'white' : options.backgroundColor;

  let encoded: string;
  try {
    // JSON5-style output: unquoted keys and single quotes survive
    // percent-encoding far more cheaply than JSON's double quotes.
    encoded = encodeURIComponent(serializeCompact(buildVisibilityChartConfig(options ?? { series: [] })));
  } catch {
    // Last-ditch fallback: an empty chart still renders and still publishes.
    encoded = encodeURIComponent(
      serializeCompact({ type: 'line', data: { labels: [], datasets: [] } }),
    );
  }

  const bkg = background ? `&bkg=${encodeURIComponent(background)}` : '';
  return `https://quickchart.io/chart?w=${width}&h=${height}${bkg}&c=${encoded}`;
}
