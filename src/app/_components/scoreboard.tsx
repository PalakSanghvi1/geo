'use client';

import { useState } from 'react';
import { deltaColumnLabel } from '@/lib/labels';
import type { ScoreboardRow } from '@/lib/types';
import { assignBrandColors } from './brand-colors';
import { Badge, Button, Card, Delta, EmptyState, METER_W, Meter, Skeleton, cx } from './ui';

/** Rows shown before the reader asks for the long tail. */
const COLLAPSED = 6;

const CELL = 'px-5 py-3';
const NUM = cx(CELL, 'numeric whitespace-nowrap');

function HeaderRow({ deltaWindowDays }: { deltaWindowDays: number }) {
  return (
    <thead>
      <tr className="border-b border-hairline">
        <th scope="col" className={cx(CELL, 'field-label w-10 text-left')}>
          #
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left')}>
          Brand
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left')}>
          Visibility
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left')}>
          {deltaColumnLabel(deltaWindowDays)}
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left')}>
          Position
        </th>
        <th scope="col" className={cx(CELL, 'field-label text-left')}>
          Sentiment
        </th>
      </tr>
    </thead>
  );
}

function ScoreboardSkeleton() {
  return (
    <tbody>
      {Array.from({ length: COLLAPSED }, (_, i) => (
        <tr key={i} className="border-b border-hairline last:border-0">
          <td className={CELL}>
            <Skeleton className="h-3 w-3" />
          </td>
          <td className={CELL}>
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-1.5 w-1.5 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </td>
          <td className={CELL}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-9" />
              <Skeleton className="h-[3px] w-[148px]" />
            </div>
          </td>
          <td className={CELL}>
            <Skeleton className="h-3 w-10" />
          </td>
          <td className={CELL}>
            <Skeleton className="h-3 w-8" />
          </td>
          <td className={CELL}>
            <Skeleton className="h-3 w-8" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export function Scoreboard({
  rows,
  deltaWindowDays = 0,
  loading,
}: {
  rows: ScoreboardRow[];
  /** How many days `delta7` averaged over; labels the Δ column honestly. */
  deltaWindowDays?: number;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <Card>
        <table className="w-full text-sm">
          <HeaderRow deltaWindowDays={deltaWindowDays} />
          <ScoreboardSkeleton />
        </table>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title="No brand mentions in this window yet." />
      </Card>
    );
  }

  const colors = assignBrandColors(rows);
  const visible = expanded ? rows : rows.slice(0, COLLAPSED);

  return (
    <Card>
      <table className="w-full text-sm">
        <caption className="sr-only">
          Competitor scoreboard, ranked by share of answers mentioning each brand
        </caption>
        <HeaderRow deltaWindowDays={deltaWindowDays} />
        <tbody>
          {visible.map((row, i) => (
            <tr
              key={row.brand}
              className={cx(
                'border-b border-hairline last:border-0',
                row.isSelf && 'bg-accent-wash'
              )}
            >
              <td className={cx(CELL, 'numeric text-ink-muted')}>{i + 1}</td>
              <td className={CELL}>
                <div className="flex items-center gap-2.5">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: colors.get(row.brand) }}
                    aria-hidden
                  />
                  <span className={row.isSelf ? 'font-medium' : undefined}>{row.brand}</span>
                  {row.isSelf ? <Badge tone="accent">You</Badge> : null}
                </div>
              </td>
              <td className={CELL}>
                <div className="flex items-center gap-3">
                  <span className="numeric w-9 text-right">{row.visibility.toFixed(0)}%</span>
                  <div className={METER_W}>
                    <Meter value={row.visibility} self={row.isSelf} />
                  </div>
                </div>
              </td>
              <td className={NUM}>
                <Delta value={row.delta7} />
              </td>
              <td className={NUM}>
                {row.avgPosition === null ? '—' : row.avgPosition.toFixed(1)}
              </td>
              <td className={NUM}>
                {row.sentiment > 0 ? '+' : ''}
                {Math.round(row.sentiment)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > COLLAPSED ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className={cx(
            CELL,
            'block w-full border-t border-hairline text-left text-[13px] text-accent-ink transition-colors hover:text-ink',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
          )}
        >
          {expanded ? 'Show top 6 →' : `View all ${rows.length} competitors →`}
        </button>
      ) : null}
    </Card>
  );
}
