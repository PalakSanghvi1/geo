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
 * "vs the 7-day average", plus a warning when that average is fabricated.
 *
 * `delta7` subtracts the mean of the prior run days from the latest one. When every
 * one of those prior days is illustrative, the result is a measured number minus an
 * invented baseline: still the defined metric, but not a change in how the models
 * answer, and nothing on screen said so.
 */
export function deltaWindowPhrase(days: number, baselineIsIllustrative = false): string {
  if (days <= 0) return 'no prior day to compare';
  const window = days === 1 ? 'vs the previous day' : `vs the ${days}-day average`;
  return baselineIsIllustrative ? `${window} (illustrative baseline)` : window;
}

/** Compact column header: "Δ 7d". */
export function deltaColumnLabel(days: number): string {
  return days <= 0 ? 'Δ' : `Δ ${days}d`;
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
