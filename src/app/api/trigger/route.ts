/**
 * POST /api/trigger   body: { note?: string }   ->  { id }
 *
 * Queues a run by inserting a `run_requests` row. The worker (geo-worker)
 * polls that table every 5 seconds and executes the run — this route must
 * NEVER execute a run itself, so that scheduled, Slack-triggered and
 * dashboard-triggered runs all share one code path.
 */
import { run as exec } from '@/lib/db';
import { fail, ok, readJsonBody } from '../_lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_NOTE_LENGTH = 500;

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const rawNote = body.note;
    const note =
      typeof rawNote === 'string' && rawNote.trim().length > 0
        ? rawNote.trim().slice(0, MAX_NOTE_LENGTH)
        : null;

    const info = exec(
      `INSERT INTO run_requests (requested_by, note, status) VALUES (?, ?, 'pending')`,
      ['dashboard', note]
    );

    return ok({ id: Number(info.lastInsertRowid) }, 201);
  } catch (err) {
    return fail(err);
  }
}
