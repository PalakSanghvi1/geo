/**
 * Wording for the visibility delta.
 *
 * `delta7` is the latest run day minus the mean of the run days before it, and
 * that prior window is only seven days long once seven days have been
 * collected. Early on it is shorter — on a database with two run dates the
 * comparison is against a single day. Labelling that "vs 7-day avg" states a
 * number of days that were never collected, so every surface that prints the
 * delta asks for its wording here and gets the window it actually has.
 *
 * Pure and dependency-free: client components import it, and importing
 * `metrics.ts` instead would pull better-sqlite3 into the browser bundle.
 */

/** Longest prior window `getOverview` will average over. */
export const DELTA_WINDOW_MAX = 7;

/** Sentence-tail wording, e.g. "↑ 4.0 pts vs the previous day". */
export function deltaLabel(windowDays: number): string {
  if (windowDays <= 0) return 'no earlier day to compare';
  if (windowDays === 1) return 'vs the previous day';
  if (windowDays < DELTA_WINDOW_MAX) return `vs the previous ${windowDays} days`;
  return 'vs the 7-day average';
}

/** Column-header form, e.g. "Δ 1d". */
export function deltaHeader(windowDays: number): string {
  return windowDays <= 0 ? 'Δ' : `Δ ${windowDays}d`;
}

/** What a reader calls each provider. One map, so the tabs and the reports agree. */
const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  gemini: 'Gemini',
};

export function providerLabel(id: string): string {
  return PROVIDER_LABELS[id] ?? id;
}

/**
 * "Claude, GPT and Gemini" — built from the providers that actually answered,
 * so a provider that collected nothing is not claimed in prose.
 */
export function providerList(ids: string[]): string {
  const names = ids.map(providerLabel);
  if (names.length === 0) return 'no models yet';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
