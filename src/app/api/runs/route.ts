/**
 * GET /api/runs  ->  Run[]   (most recent first, capped at 50)
 *
 * The Runs page polls this every 5 seconds for live status, so it is one
 * indexed read of a small table and nothing else — no joins, no aggregation.
 */
import { all } from '@/lib/db';
import type { Run } from '@/lib/types';
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
    return ok(runs);
  } catch (err) {
    return fail(err);
  }
}
