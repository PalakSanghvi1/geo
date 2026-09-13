/**
 * GET /api/sources?days=14[&provider=all]  ->  SourceRow[]
 *
 * Domain-level aggregation of the citations attached to ok answers in the
 * window, computed by `getSources` in src/lib/metrics.ts.
 */
import type { NextRequest } from 'next/server';
import { getSources } from '@/lib/metrics';
import type { SourceRow } from '@/lib/types';
import { fail, ok, parseDays, parseProvider } from '../_lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const days = parseDays(params);
    const provider = parseProvider(params);

    // Empty DB: recentDates() is empty, so getSources returns [].
    const rows: SourceRow[] = getSources(days, provider);
    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}
