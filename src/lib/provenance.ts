/**
 * One definition of which runs are measurements.
 *
 * `synthetic` rows are invented numbers — no provider was called. Everything else
 * is a real model answer, `backfill` included: those carry a simulated date, but a
 * model was genuinely asked and genuinely replied, and the citations on a backfilled
 * answer are real retrievals.
 *
 * That distinction is deliberate and was argued over. Collapsing backfill into
 * synthetic zeroes `measuredDays` on the deployed database, which would have the
 * dashboard declare every number on it fabricated — including 180 real answers and
 * the whole Sources page. A simulated date is a caveat; an invented number is a
 * different kind of thing.
 *
 * `firstLiveDate` is the separate, narrower question of which days were collected
 * on the date they carry, and that one does exclude backfill.
 *
 * Every query that distinguishes measured from invented reads from here. When this
 * lived as an inline `trigger != 'synthetic'` in each caller, `export-evalset.ts`
 * was for a while the only consumer that filtered at all.
 */
import type { RunTrigger } from './types';

/** Triggers whose rows are invented rather than collected. */
export const FABRICATED_TRIGGERS: readonly RunTrigger[] = ['synthetic'];

/** Triggers backed by a real provider response, whatever date they are filed under. */
export const MEASURED_TRIGGERS: readonly RunTrigger[] = ['scheduled', 'manual', 'backfill'];

export function isFabricated(trigger: RunTrigger): boolean {
  return FABRICATED_TRIGGERS.includes(trigger);
}

/**
 * SQL fragment restricting to measured runs. Inlined rather than parameterised
 * because the values are a compile-time constant of this module, never input.
 * `alias` is the `runs` table alias in the caller's query.
 */
export function measuredRunsClause(alias = 'r'): string {
  const list = MEASURED_TRIGGERS.map((t) => `'${t}'`).join(', ');
  return `${alias}.trigger IN (${list})`;
}

/**
 * Today as `YYYY-MM-DD` in UTC, which is the calendar `runs.run_date` is filed on.
 *
 * `backfill.ts` and `seed-synthetic.ts` derive their dates from `setUTCDate`, while
 * the worker and the Slack digest each had their own local-time helper. On a host
 * east or west of UTC those disagree for part of every day, and the same calendar day
 * then lands under two different `run_date` strings — two rows in the chart, each
 * with half the answers and therefore its own denominator.
 */
export function runDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The most recent Sunday strictly before today, in the same UTC calendar. */
export function lastWeekEndingDate(): string {
  const d = new Date();
  const daysBack = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}
