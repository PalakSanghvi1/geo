'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { datasetCaption, isMostlySynthetic } from '@/lib/labels';
import type { DatasetShape, ScoreboardRow, SeriesPoint } from '@/lib/types';
import { HAIRLINE, INK, INK_FAINT, INK_MUTED, chartBrands } from './brand-colors';
import { formatRunDay } from '../_lib/dates';
import { Badge, Card, CardTitle, Skeleton, cx } from './ui';

/**
 * Chart geometry is pinned so the end-label gutter can be positioned in HTML
 * rather than per-line SVG labels: Recharts renders each line's label without
 * knowing about the others, so two brands a point apart print on top of each
 * other. Laying them out ourselves lets us push them apart.
 */
const CHART_H = 288;
const X_AXIS_H = 48;
const MARGIN = { top: 12, right: 124, bottom: 4, left: 4 };
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom - X_AXIS_H;
/** Minimum vertical gap between two end labels. */
const LABEL_GAP = 15;
/**
 * Above this many days, labelling every date would overlap even at an angle, so
 * the axis thins out to `TICK_COUNT` evenly spaced labels instead. The Overview
 * page currently offers 7 and 14 day windows, so in practice every date is
 * labelled; the fallback is here so a longer window added later degrades
 * sensibly rather than turning the axis into a smear.
 */
const MAX_DATE_LABELS = 21;
/** How many labels to fall back to once the window is too long to label fully. */
const TICK_COUNT = 5;

/** Recharts wants one object per x value, so the long series is pivoted wide. */
interface Row {
  date: string;
  [brand: string]: string | number | null;
}

function pivot(series: SeriesPoint[], brands: Array<{ brand: string }>): Row[] {
  const wanted = new Set(brands.map((b) => b.brand));
  const byDate = new Map<string, Row>();
  for (const point of series) {
    if (!wanted.has(point.brand)) continue;
    const row = byDate.get(point.date) ?? ({ date: point.date } as Row);
    row[point.brand] = point.visibility;
    byDate.set(point.date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div className="rounded-card border border-hairline bg-card px-3 py-2 text-[12px] shadow-sm">
      <div className="field-label mb-1.5">{label ? formatRunDay(label) : ''}</div>
      {rows.map((row) => (
        <div key={row.name} className="flex items-center gap-2 py-px">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.color }} aria-hidden />
          <span className="flex-1 pr-3">{row.name}</span>
          <span className="numeric font-medium">{Math.round(row.value ?? 0)}%</span>
        </div>
      ))}
    </div>
  );
}

export function VisibilityChart({
  series,
  scoreboard,
  dataset,
  liveFrom,
  loading,
}: {
  series: SeriesPoint[];
  scoreboard: ScoreboardRow[];
  /** Provenance of what is plotted; null while the first response is in flight. */
  dataset?: DatasetShape | null;
  /** First run-date that was collected live rather than backfilled. */
  liveFrom?: string;
  loading?: boolean;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const brands = useMemo(() => {
    // A scoreboard brand with no points in the window would draw an empty line.
    // Colours still come from the full scoreboard so they match the table.
    const present = new Set(series.map((p) => p.brand));
    return chartBrands(scoreboard, (brand) => present.has(brand));
  }, [series, scoreboard]);
  const rows = useMemo(() => pivot(series, brands), [series, brands]);

  const yMax = useMemo(() => {
    const values = series
      .map((p) => p.visibility)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const peak = Math.max(10, ...values);
    return Math.ceil(peak / 20) * 20;
  }, [series]);

  /**
   * Evenly spaced date labels that always include the first and last day.
   *
   * The previous version stepped by a fixed interval and then appended the last
   * day if the loop had missed it, which put the final two labels on adjacent
   * days while every other pair sat three apart — the axis read as regular until
   * the right-hand edge. Interpolating the positions instead keeps every gap
   * within a day of the others, whatever the window length.
   */
  const ticks = useMemo(() => {
    const n = rows.length;
    if (n === 0) return [] as string[];
    if (n <= MAX_DATE_LABELS) return rows.map((r) => r.date);

    // Too long to label every day: evenly spaced, both ends always included.
    const out: string[] = [];
    for (let i = 0; i < TICK_COUNT; i += 1) {
      const date = rows[Math.round((i * (n - 1)) / (TICK_COUNT - 1))].date;
      if (out[out.length - 1] !== date) out.push(date);
    }
    return out;
  }, [rows]);

  const caption = dataset ? datasetCaption(dataset) : null;
  const illustrative = dataset ? isMostlySynthetic(dataset) : false;

  const toggle = (brand: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(brand)) next.delete(brand);
      else next.add(brand);
      return next;
    });

  /** Brand labels down the right gutter, nudged apart where values crowd. */
  const endLabels = useMemo(() => {
    const last = rows[rows.length - 1];
    if (!last) return [];

    const placed = brands
      .filter((b) => !hidden.has(b.brand))
      .map((b) => ({ ...b, value: Number(last[b.brand] ?? 0) }))
      .sort((a, b) => b.value - a.value)
      .map((b) => ({ ...b, y: MARGIN.top + (1 - b.value / yMax) * PLOT_H }));

    for (let i = 1; i < placed.length; i += 1) {
      placed[i].y = Math.max(placed[i].y, placed[i - 1].y + LABEL_GAP);
    }
    // Pushing down can run past the axis; lift the whole stack back inside.
    const overflow = (placed.at(-1)?.y ?? 0) - (MARGIN.top + PLOT_H);
    if (overflow > 0) for (const label of placed) label.y -= overflow;

    return placed;
  }, [rows, brands, hidden, yMax]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>
              Visibility <span className="text-ink-muted">— % of answers mentioning each brand</span>
            </CardTitle>
            {/* Stated at the title, not in a tooltip: a reader who finds out on the Runs
                page that most of this line was generated will discount the rest. */}
            {illustrative ? <Badge tone="warn">ILLUSTRATIVE HISTORY</Badge> : null}
          </div>
          {caption ? (
            <p className="mt-1 max-w-2xl text-[12.5px] text-ink-muted">{caption}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {brands.map((b) => {
            const off = hidden.has(b.brand);
            return (
              <button
                key={b.brand}
                type="button"
                onClick={() => toggle(b.brand)}
                aria-pressed={!off}
                className={cx(
                  'flex items-center gap-1.5 rounded text-[12px] transition-opacity',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  off ? 'opacity-40' : 'opacity-100'
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: b.color }}
                  aria-hidden
                />
                <span className={b.isSelf ? 'font-medium text-ink' : 'text-ink-muted'}>
                  {b.brand}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-2 pt-2 pb-4">
        {loading ? (
          <Skeleton className="mx-3 h-[288px]" />
        ) : rows.length === 0 ? (
          <div className="flex h-[288px] items-center px-5 text-sm text-ink-muted">
            No runs in this window yet.
          </div>
        ) : (
          <div className="relative">
            <ResponsiveContainer width="100%" height={CHART_H}>
            <LineChart data={rows} margin={MARGIN}>
              <CartesianGrid stroke={HAIRLINE} vertical={false} />
              <XAxis
                dataKey="date"
                ticks={ticks}
                tickFormatter={formatRunDay}
                tickLine={false}
                axisLine={false}
                // interval={0} stops Recharts dropping labels it thinks collide;
                // the angle is what makes room for them.
                interval={0}
                angle={-45}
                textAnchor="end"
                tick={{ fill: INK_FAINT, fontSize: 11 }}
                tickMargin={8}
                height={X_AXIS_H}
              />
              <YAxis
                domain={[0, yMax]}
                ticks={Array.from({ length: yMax / 20 + 1 }, (_, i) => i * 20)}
                tickLine={false}
                axisLine={false}
                width={34}
                tick={{ fill: INK_FAINT, fontSize: 11 }}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ stroke: HAIRLINE, strokeWidth: 1 }}
              />
              {liveFrom && rows.some((r) => r.date === liveFrom) ? (
                <ReferenceLine
                  x={liveFrom}
                  stroke={INK_FAINT}
                  strokeDasharray="3 3"
                  label={{
                    value: 'live runs →',
                    position: 'insideTopLeft',
                    fill: INK_MUTED,
                    fontSize: 10,
                    offset: 8,
                  }}
                />
              ) : null}
              {brands.map((b) =>
                hidden.has(b.brand) ? null : (
                  <Line
                    key={b.brand}
                    type="monotone"
                    dataKey={b.brand}
                    stroke={b.color}
                    strokeWidth={b.isSelf ? 2.25 : 1.25}
                    dot={false}
                    activeDot={{ r: 3.5, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                )
              )}
            </LineChart>
            </ResponsiveContainer>
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-[124px]"
              aria-hidden
            >
              {endLabels.map((label) => (
                <span
                  key={label.brand}
                  className="absolute left-2.5 text-[11px] whitespace-nowrap"
                  style={{
                    top: label.y - 7,
                    color: label.isSelf ? INK : INK_MUTED,
                    fontWeight: label.isSelf ? 600 : 400,
                  }}
                >
                  {label.brand} {Math.round(label.value)}%
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
