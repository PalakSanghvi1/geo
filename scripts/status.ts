/**
 * Print current database state.
 *
 *   npm run status
 *
 * Exists so the VPS can be inspected over SSH without a browser, and so a bad demo
 * can be diagnosed in one command instead of by poking at SQLite.
 */
import '../src/lib/env';
import { all } from '../src/lib/db';
import { getOverview, getSignals } from '../src/lib/metrics';

function main() {
  const counts = all<{ label: string; n: number }>(
    `SELECT 'brands' AS label, COUNT(*) AS n FROM brands
     UNION ALL SELECT 'prompts', COUNT(*) FROM queries WHERE active = 1
     UNION ALL SELECT 'runs', COUNT(*) FROM runs
     UNION ALL SELECT 'answers (ok)', COUNT(*) FROM answers WHERE status = 'ok'
     UNION ALL SELECT 'answers (error)', COUNT(*) FROM answers WHERE status = 'error'
     UNION ALL SELECT 'mentions', COUNT(*) FROM mentions
     UNION ALL SELECT 'suggestions', COUNT(*) FROM suggestions`
  );
  console.log('=== counts ===');
  for (const c of counts) console.log(`  ${c.label.padEnd(16)} ${c.n}`);

  const runs = all<{
    id: number;
    run_date: string;
    trigger: string;
    status: string;
    ok_calls: number;
    total_calls: number;
  }>(`SELECT id, run_date, trigger, status, ok_calls, total_calls FROM runs ORDER BY id DESC LIMIT 10`);
  if (runs.length) {
    console.log('\n=== recent runs ===');
    for (const r of runs) {
      console.log(
        `  #${String(r.id).padStart(3)} ${r.run_date} ${r.trigger.padEnd(9)} ` +
          `${r.status.padEnd(8)} ${r.ok_calls}/${r.total_calls}`
      );
    }
  }

  const overview = getOverview(14, 'all');
  if (overview.scoreboard.length) {
    console.log('\n=== visibility (latest day) ===');
    for (const row of overview.scoreboard.slice(0, 12)) {
      const delta = row.delta7 > 0 ? `+${row.delta7}` : String(row.delta7);
      console.log(
        `  ${(row.isSelf ? '*' : ' ')} ${row.brand.padEnd(24)} ` +
          `${String(row.visibility).padStart(5)}%  d7 ${delta.padStart(6)}  ` +
          `pos ${row.avgPosition ?? '-'}  sent ${row.sentiment}`
      );
    }
    console.log('  (* = your brand)');
  }

  const signals = getSignals(14);
  if (signals.length) {
    console.log('\n=== signals ===');
    for (const s of signals) console.log(`  [${s.kind}] ${s.text}`);
  }

  const errors = all<{ provider: string; error: string; n: number }>(
    `SELECT provider, substr(COALESCE(error,''), 1, 90) AS error, COUNT(*) AS n
       FROM answers WHERE status = 'error' GROUP BY provider, error ORDER BY n DESC LIMIT 5`
  );
  if (errors.length) {
    console.log('\n=== recent failures ===');
    for (const e of errors) console.log(`  ${e.provider} ×${e.n}: ${e.error}`);
  }
}

main();
