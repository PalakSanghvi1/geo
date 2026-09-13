/**
 * One definition of which runs are measurements.
 *
 * `synthetic` rows are fabricated outright. `backfill` rows hold real provider
 * answers replayed onto dates they were never collected on, and the team's
 * decision is that both leave with the demo: neither is an observation of what
 * the models said on the date it is filed under. Treating them alike is what
 * lets a caption say "2 days measured, 88 illustrative" without qualification.
 *
 * Only `scheduled` and `manual` runs happened when they say they happened.
 *
 * Every query that distinguishes the two reads from here. When this lived as an
 * inline `trigger != 'synthetic'` in each caller, adding a third fabricated
 * trigger meant finding all of them, and `export-evalset.ts` was for a while the
 * only consumer that filtered at all.
 */
import type { RunTrigger } from './types';

/** Triggers whose rows are not measurements of the date they carry. */
export const FABRICATED_TRIGGERS: readonly RunTrigger[] = ['synthetic', 'backfill'];

/** Triggers that collected a live answer on the date they carry. */
export const MEASURED_TRIGGERS: readonly RunTrigger[] = ['scheduled', 'manual'];

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
