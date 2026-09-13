/**
 * Execute a single run right now.
 *
 *   npm run run-once                    # today, all prompts, all providers
 *   npm run run-once -- --limit 3       # sample 3 prompts (use this while testing)
 *   npm run run-once -- --date 2026-09-10
 *   npm run run-once -- --providers anthropic,openai
 */
import '../src/lib/env';
import { executeRun } from '../src/pipeline/runner';
import type { ProviderId, RunTrigger } from '../src/lib/types';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const date = flag('date') ?? today();
  const limit = flag('limit') ? Number(flag('limit')) : undefined;
  const providers = flag('providers')
    ?.split(',')
    .map((p) => p.trim())
    .filter(Boolean) as ProviderId[] | undefined;
  const trigger = (flag('trigger') as RunTrigger | undefined) ?? 'manual';

  console.log(
    `run: date=${date} trigger=${trigger}` +
      `${limit ? ` limit=${limit}` : ''}${providers ? ` providers=${providers.join(',')}` : ''}\n`
  );

  let lastPrinted = 0;
  const summary = await executeRun(date, trigger, {
    limit,
    providers,
    onProgress: (done, total) => {
      // Throttle progress output so a 135-call run doesn't produce 135 lines.
      const pct = Math.floor((done / total) * 100);
      if (pct >= lastPrinted + 10 || done === total) {
        lastPrinted = pct;
        process.stdout.write(`  ${done}/${total} (${pct}%)\n`);
      }
    },
  });

  console.log(`\nrun #${summary.runId} — ${summary.status.toUpperCase()}`);
  console.log(`  ${summary.ok}/${summary.total} answers in ${(summary.elapsedMs / 1000).toFixed(1)}s`);
  for (const [provider, counts] of Object.entries(summary.byProvider)) {
    console.log(
      `  ${provider.padEnd(10)} ok ${String(counts.ok).padStart(3)}  failed ${counts.failed}`
    );
  }
  if (summary.status === 'failed') process.exit(1);
}

main();
