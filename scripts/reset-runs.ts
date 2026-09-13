/**
 * Delete collected runs so a clean backfill can be built.
 *
 *   npm run reset-runs -- --yes           # all runs, answers and mentions
 *   npm run reset-runs -- --yes --run 2   # one run only
 *
 * Keeps brands and queries: those are the tracked configuration, and deleting them
 * would change what the historical numbers even mean. Requires --yes, because on
 * demo day this is one keystroke away from erasing the data the demo runs on.
 */
import '../src/lib/env';
import { getDb, all, get } from '../src/lib/db';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  const db = getDb();
  const runId = flag('run') ? Number(flag('run')) : undefined;

  const runs = runId
    ? all<{ id: number; run_date: string; status: string }>(
        `SELECT id, run_date, status FROM runs WHERE id = ?`,
        [runId]
      )
    : all<{ id: number; run_date: string; status: string }>(
        `SELECT id, run_date, status FROM runs ORDER BY id`
      );

  if (runs.length === 0) {
    console.log('reset-runs: nothing to delete.');
    return;
  }

  const answers =
    get<{ n: number }>(
      runId
        ? `SELECT COUNT(*) AS n FROM answers WHERE run_id = ?`
        : `SELECT COUNT(*) AS n FROM answers`,
      runId ? [runId] : []
    )?.n ?? 0;

  console.log(`Would delete ${runs.length} run(s) and ${answers} answer(s):`);
  for (const r of runs) console.log(`  #${r.id} ${r.run_date} (${r.status})`);

  if (!process.argv.includes('--yes')) {
    console.log('\nRe-run with --yes to actually delete. Nothing was changed.');
    return;
  }

  const ids = runs.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');

  // Children first — mentions reference answers, answers reference runs.
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM mentions WHERE answer_id IN (SELECT id FROM answers WHERE run_id IN (${placeholders}))`
    ).run(...ids);
    db.prepare(`DELETE FROM answers WHERE run_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM run_requests WHERE run_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM runs WHERE id IN (${placeholders})`).run(...ids);
  });
  tx();

  console.log(`\nreset-runs: deleted ${runs.length} run(s), ${answers} answer(s). Brands and queries kept.`);
}

main();
