/**
 * POST /api/trigger   body: { note?: string }   ->  { id }
 *
 * Queues a run by inserting a `run_requests` row. The worker (geo-worker)
 * polls that table every 5 seconds and executes the run — this route must
 * NEVER execute a run itself, so that scheduled, Slack-triggered and
 * dashboard-triggered runs all share one code path.
 */
import { get, run as exec } from '@/lib/db';
import { ConflictError, fail, ok, readJsonBody } from '../_lib/http';

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

    // One queued run at a time. The button re-enables as soon as this POST returns
    // while the run itself takes minutes, so an impatient second click used to queue
    // a second full run — 135 more provider calls, landing on the same run_date and
    // merging into that day's denominator.
    const inFlight = get<{ id: number; status: string }>(
      `SELECT id, status FROM run_requests
        WHERE status IN ('pending', 'picked_up')
        ORDER BY id DESC LIMIT 1`
    );
    if (inFlight) {
      throw new ConflictError(
        inFlight.status === 'pending'
          ? `Run request #${inFlight.id} is already queued.`
          : `Run request #${inFlight.id} is running — wait for it to finish.`
      );
    }

    const info = exec(
      `INSERT INTO run_requests (requested_by, note, status) VALUES (?, ?, 'pending')`,
      ['dashboard', note]
    );

    return ok({ id: Number(info.lastInsertRowid) }, 201);
  } catch (err) {
    return fail(err);
  }
}
