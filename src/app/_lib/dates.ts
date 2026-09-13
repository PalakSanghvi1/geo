/**
 * One place that turns a run date into a label.
 *
 * Every surface that shows a run day — the visibility chart's x axis, its
 * tooltip, the Runs table — reads from here, so "Sep 8" means the same thing
 * and is written the same way wherever it appears. Two separate copies of this
 * had already drifted apart in wording while agreeing by luck on output.
 *
 * Deliberately string arithmetic, not `Date`: a run date is a calendar day, and
 * parsing 'YYYY-MM-DD' through Date reads it as UTC midnight, which renders as
 * the previous day for anyone west of Greenwich.
 */
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** '2026-09-08' → 'Sep 8'. Anything unparseable is returned untouched. */
export function formatRunDay(value: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return value;
  const month = MONTHS[Number(parts[2]) - 1];
  return month ? `${month} ${Number(parts[3])}` : value;
}
