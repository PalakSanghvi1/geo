/**
 * GET  /api/suggestions               ->  Suggestion[]  (pending only)
 * POST /api/suggestions  { id, action: 'approve' | 'dismiss' }
 *
 * Approving a 'query' suggestion inserts it into `queries` (active = 1);
 * approving a 'competitor' suggestion inserts it into `brands`
 * (is_self = 0, aliases '[]'). Either way the suggestion's status is set.
 *
 * Pushing a suggestion to Linear is Workstream C's job — this route never
 * touches the `linear_issue_id` column.
 */
import { getDb, all, get } from '@/lib/db';
import type { Suggestion, SuggestionKind } from '@/lib/types';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  fail,
  ok,
  parseId,
  readJsonBody,
} from '../_lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Action = 'approve' | 'dismiss';

const SUGGESTION_COLUMNS = `id, kind, text, rationale, source, status, linear_issue_id, created_at`;

export async function GET() {
  try {
    const rows = all<Suggestion>(
      `SELECT ${SUGGESTION_COLUMNS}
         FROM suggestions
        WHERE status = 'pending'
        ORDER BY created_at DESC, id DESC`
    );
    // Empty DB: [].
    return ok(rows);
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const id = parseId(body.id);

    const action = body.action;
    if (action !== 'approve' && action !== 'dismiss') {
      throw new BadRequestError(`Invalid 'action': must be 'approve' or 'dismiss'`);
    }

    const suggestion = get<Suggestion>(
      `SELECT ${SUGGESTION_COLUMNS} FROM suggestions WHERE id = ?`,
      [id]
    );
    if (!suggestion) throw new NotFoundError(`No suggestion with id ${id}`);
    if (suggestion.status !== 'pending') {
      throw new ConflictError(`Suggestion ${id} was already ${suggestion.status}`);
    }

    const created = applyAction(suggestion, action as Action);

    const updated = get<Suggestion>(
      `SELECT ${SUGGESTION_COLUMNS} FROM suggestions WHERE id = ?`,
      [id]
    );

    return ok({ suggestion: updated ?? suggestion, created });
  } catch (err) {
    return fail(err);
  }
}

interface CreatedRecord {
  table: 'queries' | 'brands' | null;
  id: number | null;
  /** true when an identical row already existed, so nothing new was inserted. */
  duplicate: boolean;
}

/**
 * Status change + any insert happen in one transaction so a failed insert can
 * never leave a suggestion marked approved with nothing behind it.
 */
function applyAction(suggestion: Suggestion, action: Action): CreatedRecord {
  const db = getDb();

  const tx = db.transaction((): CreatedRecord => {
    let created: CreatedRecord = { table: null, id: null, duplicate: false };

    if (action === 'approve') {
      const kind: SuggestionKind = suggestion.kind === 'competitor' ? 'competitor' : 'query';
      const text = suggestion.text.trim();

      if (text.length === 0) {
        throw new BadRequestError(`Suggestion ${suggestion.id} has empty text`);
      }

      if (kind === 'query') {
        const existing = db
          .prepare(`SELECT id FROM queries WHERE text = ? LIMIT 1`)
          .get(text) as { id: number } | undefined;
        if (existing) {
          created = { table: 'queries', id: existing.id, duplicate: true };
        } else {
          const info = db
            .prepare(
              `INSERT INTO queries (text, parent_id, tag, active) VALUES (?, NULL, ?, 1)`
            )
            .run(text, 'suggested');
          created = { table: 'queries', id: Number(info.lastInsertRowid), duplicate: false };
        }
      } else {
        const existing = db
          .prepare(`SELECT id FROM brands WHERE lower(name) = lower(?) LIMIT 1`)
          .get(text) as { id: number } | undefined;
        if (existing) {
          created = { table: 'brands', id: existing.id, duplicate: true };
        } else {
          const info = db
            .prepare(`INSERT INTO brands (name, is_self, aliases) VALUES (?, 0, '[]')`)
            .run(text);
          created = { table: 'brands', id: Number(info.lastInsertRowid), duplicate: false };
        }
      }
    }

    db.prepare(`UPDATE suggestions SET status = ? WHERE id = ?`).run(
      action === 'approve' ? 'approved' : 'dismissed',
      suggestion.id
    );

    return created;
  });

  return tx();
}
