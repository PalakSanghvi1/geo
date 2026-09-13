/**
 * GET /api/runs  ->  RunRow[]   (most recent first, capped at 50)
 *
 * The Runs page polls this every 5 seconds for live status, so it stays cheap: one
 * indexed read of a small table, plus a single grouped count over the answers of those
 * runs. Two queries, no per-row work.
 *
 * The per-provider split is included because the page previously approximated it —
 * dividing total_calls evenly and charging every failure to the last provider — which
 * invented numbers on the one page whose job is to report what actually happened.
 */
import { all } from '@/lib/db';
import type { ProviderId, Run, RunProviderCounts, RunRow } from '@/lib/types';
import { fail, ok } from '../_lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const LIMIT = 50;

export async function GET() {
  try {
    const runs = all<Run>(
      `SELECT id, run_date, trigger, status, started_at, finished_at,
              total_calls, ok_calls, failed_calls
         FROM runs
        ORDER BY run_date DESC, id DESC
        LIMIT ?`,
      [LIMIT]
    );

    // Empty DB: [] — the UI renders its empty state.
    if (runs.length === 0) return ok([]);

    const ids = runs.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const counts = all<{ run_id: number; provider: string; ok: number; failed: number }>(
      `SELECT run_id,
              provider,
              SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END)    AS ok,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed
         FROM answers
        WHERE run_id IN (${placeholders})
        GROUP BY run_id, provider`,
      ids
    );

    const byRun = new Map<number, RunProviderCounts[]>();
    for (const row of counts) {
      const list = byRun.get(row.run_id) ?? [];
      list.push({
        provider: row.provider as ProviderId,
        ok: row.ok,
        failed: row.failed,
        total: row.ok + row.failed,
      });
      byRun.set(row.run_id, list);
    }

    const rows: RunRow[] = runs.map((run) => ({
      ...run,
      byProvider: byRun.get(run.id) ?? [],
    }));

    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}
