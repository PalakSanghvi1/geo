import type { DatasetShape, ProviderId } from './types';

/**
 * Wording derived from the dataset, so no screen asserts a shape the data lacks.
 *
 * These live here rather than in a component because the dashboard, the Slack digest
 * and the Notion report all describe the same numbers. If they word the window
 * differently, one of them is lying, and it is not obvious which.
 */

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  gemini: 'Gemini',
};

/**
 * "vs 3 days ago, measured" — the delta's actual basis, never a fixed window.
 *
 * `delta7` used to be the latest day minus the mean of the seven before it, printed
 * as "vs the 7-day average" whatever those days held. It now compares two measured
 * days, and the gap between them is whatever collection managed, so the label reads
 * the gap rather than asserting a week.
 */
export function deltaComparisonPhrase(gapDays: number | null): string | null {
  if (gapDays === null || gapDays <= 0) return null;
  if (gapDays === 1) return 'vs yesterday, measured';
  return `vs ${gapDays} days ago, measured`;
}

/** Compact column header: "Δ 3d", or null when there is no comparison to show. */
export function deltaColumnLabel(gapDays: number | null): string | null {
  return gapDays === null || gapDays <= 0 ? null : `Δ ${gapDays}d`;
}

/**
 * What the headline figures are read from, when that is not the newest day.
 *
 * Silence when it IS the newest day: a date stamp on a current number is noise, and
 * the point of the stamp is to mark the exception.
 */
export function headlineBasisPhrase(dataset: DatasetShape): string | null {
  const { headlineDate, headlineIsCurrent, measuredDays } = dataset;
  if (headlineDate === null) {
    return measuredDays === 0 ? 'no measured day in this window' : null;
  }
  if (headlineIsCurrent) return null;
  return `as of ${formatRunDay(headlineDate)} — the most recent measured day`;
}

/**
 * One place that turns a run date into a label.
 *
 * Every surface that shows a run day — the visibility chart's x axis, its tooltip,
 * the Runs table, the stat card's "as of" stamp, the Slack digest — reads from here,
 * so "Sep 8" means the same thing and is written the same way wherever it appears.
 * Two separate copies had already drifted apart in wording while agreeing by luck on
 * output; this lives beside the other wording helpers so a third does not appear.
 *
 * Deliberately string arithmetic, not `Date`: a run date is a calendar day, and
 * parsing 'YYYY-MM-DD' through Date reads it as UTC midnight, which renders as the
 * previous day for anyone west of Greenwich.
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

/** "Claude, GPT and Gemini" — only the providers that actually returned answers. */
export function providerListPhrase(providers: ProviderId[]): string {
  const names = providers.map((p) => PROVIDER_LABEL[p] ?? p);
  if (names.length === 0) return 'no providers';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * One sentence under the trend chart describing the provenance of what is plotted.
 *
 * The fabricated case is stated first and in plain words. A viewer who later discovers
 * on the Runs page that most of the history was generated — when the chart itself said
 * nothing — will reasonably discount the parts that are real, which is a far worse
 * outcome than saying so upfront.
 */
export function datasetCaption(dataset: DatasetShape): string {
  const { runDays, measuredDays, illustrativeDays, providersWithMeasuredData } = dataset;
  if (runDays === 0) return 'No runs collected yet.';

  // Credit only providers that actually returned something. A provider present purely
  // through fabricated rows has collected nothing and must not be named here.
  if (measuredDays === 0) {
    // Every point on screen is fabricated. Say exactly that — there is no real
    // collection to credit, and naming providers here would invent one.
    return `${runDays} run day${runDays === 1 ? '' : 's'} plotted · all illustrative placeholder history, not measurements.`;
  }

  const providers = providerListPhrase(providersWithMeasuredData);
  const collected = `${measuredDays} day${measuredDays === 1 ? '' : 's'} collected from ${providers}`;

  if (illustrativeDays === 0) {
    return `${runDays} run day${runDays === 1 ? '' : 's'} · ${collected}.`;
  }

  return (
    `${runDays} run days plotted · ${collected} · ` +
    `the remaining ${illustrativeDays} are illustrative placeholder history, not measurements.`
  );
}

/** True when enough of the window is fabricated that the chart should carry a badge. */
export function isMostlyIllustrative(dataset: DatasetShape): boolean {
  return dataset.runDays > 0 && dataset.illustrativeDays > dataset.measuredDays;
}
