/**
 * GET /api/overview?days=14&provider=all  ->  OverviewResponse
 *
 * Thin wrapper over `getOverview` in src/lib/metrics.ts — every number the
 * dashboard shows must come from there so the dashboard, Slack digest and
 * Notion report cannot drift apart.
 */
import type { NextRequest } from 'next/server';
import { getOverview } from '@/lib/metrics';
import type { OverviewResponse } from '@/lib/types';
import { fail, ok, parseDays, parseProvider } from '../_lib/http';

// Reads a live SQLite file — must never be prerendered at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const days = parseDays(params);
    const provider = parseProvider(params);

    // Empty DB: getOverview returns empty arrays and `self: null`.
    const data: OverviewResponse = getOverview(days, provider);
    return ok(data);
  } catch (err) {
    return fail(err);
  }
}
