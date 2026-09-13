/**
 * Build trend history by running the real pipeline once per simulated past date.
 *
 *   npm run backfill                 # BACKFILL_DAYS (default 7) days back, then today
 *   npm run backfill -- --days 5
 *   npm run backfill -- --limit 3    # rehearse the loop cheaply
 *
 * A provider can be backfilled separately and merged into dates that already have
 * runs — useful when one provider is blocked on quota while the others are ready:
 *   npm run backfill -- --providers anthropic,openai
 *   npm run backfill -- --providers gemini --force   # top up the same dates later
 *
 * Metrics aggregate by run_date across every run on that date, so a second run
 * adds its answers to the same day rather than creating a competing one.
 *
 * HONESTY NOTE — this belongs in the demo and in the reliability brief:
 * the ANSWERS are real, collected live from each provider with web search on. The
 * DATES are simulated: a one-day build cannot wait a week for genuine daily history.
 * Day-to-day variation therefore reflects real model and search variance, not the
 * passage of time. Never present backfilled dates as historical observations.
 */
import '../src/lib/env';
import { executeRun, runExistsFor } from '../src/pipeline/runner';
import type { ProviderId } from '../src/lib/types';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function dateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const days = Number(flag('days') ?? process.env.BACKFILL_DAYS ?? 7);
  const limit = flag('limit') ? Number(flag('limit')) : undefined;
  const force = process.argv.includes('--force');
  const providers = flag('providers')
    ?.split(',')
    .map((p) => p.trim())
    .filter(Boolean) as ProviderId[] | undefined;

  // Oldest first, then today as a normal scheduled run.
  const plan = [
    ...Array.from({ length: days }, (_, i) => ({
      date: dateOffset(days - i),
      trigger: 'backfill' as const,
    })),
    { date: dateOffset(0), trigger: 'scheduled' as const },
  ];

  console.log(`backfill: ${plan.length} runs (${plan[0].date} → ${plan[plan.length - 1].date})\n`);
  const startedAll = Date.now();

  for (const [i, step] of plan.entries()) {
    if (!force && runExistsFor(step.date)) {
      console.log(`[${i + 1}/${plan.length}] ${step.date} — already has a run, skipping`);
      continue;
    }
    const t0 = Date.now();
    const summary = await executeRun(step.date, step.trigger, { limit, providers });
    console.log(
      `[${i + 1}/${plan.length}] ${step.date} — ${summary.status} ` +
        `${summary.ok}/${summary.total} in ${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
  }

  console.log(`\nbackfill done in ${((Date.now() - startedAll) / 60000).toFixed(1)} min`);
}

main();
