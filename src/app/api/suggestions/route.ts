/**
 * GET  /api/suggestions               ->  Suggestion[]  (pending only)
 * POST /api/suggestions  { id, action: 'approve' | 'dismiss' | 'push-to-linear' }
 *
 * Approving a 'query' suggestion inserts it into `queries` (active = 1);
 * approving a 'competitor' suggestion inserts it into `brands`
 * (is_self = 0, aliases '[]'). Either way the suggestion's status is set.
 *
 * 'push-to-linear' files the suggestion as a Linear issue via Workstream C's
 * `createIssue()`, which is what writes `linear_issue_id`. Unlike approve and
 * dismiss it is not restricted to pending rows — filing the work and deciding
 * whether to track the query are independent steps — but a dismissed suggestion
 * is refused, and an issue is never created twice for the same row.
 */
import { getDb, all, get } from '@/lib/db';
import type { Suggestion, SuggestionKind } from '@/lib/types';
import { createIssue, isLinearConfigured } from '@/integrations/linear';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  errorResponse,
  fail,
  ok,
  parseId,
  readJsonBody,
} from '../_lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Action = 'approve' | 'dismiss';
type PostAction = Action | 'push-to-linear';

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

    const action = body.action as PostAction;
    if (action !== 'approve' && action !== 'dismiss' && action !== 'push-to-linear') {
      throw new BadRequestError(
        `Invalid 'action': must be 'approve', 'dismiss' or 'push-to-linear'`
      );
    }

    const suggestion = get<Suggestion>(
      `SELECT ${SUGGESTION_COLUMNS} FROM suggestions WHERE id = ?`,
      [id]
    );
    if (!suggestion) throw new NotFoundError(`No suggestion with id ${id}`);

    if (action === 'push-to-linear') return await pushToLinear(suggestion);

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

/**
 * File a suggestion in Linear and return the refreshed row.
 *
 * `createIssue()` never throws — it logs and returns null — so the failure modes
 * are separated here instead: a server without a Linear key is a 503 the operator
 * must fix, while a rejected API call is a 502 worth retrying. Collapsing both
 * into a 500 would tell whoever is clicking the button nothing about which it was.
 */
async function pushToLinear(suggestion: Suggestion) {
  if (suggestion.linear_issue_id) {
    throw new ConflictError(
      `Suggestion ${suggestion.id} is already Linear issue ${suggestion.linear_issue_id}`
    );
  }
  if (suggestion.status === 'dismissed') {
    throw new ConflictError(`Suggestion ${suggestion.id} was dismissed — reopen it before filing it`);
  }
  if (!isLinearConfigured()) {
    return errorResponse('Linear is not configured on this server: LINEAR_API_KEY is unset.', 503);
  }

  const issueRef = await createIssue(suggestion);
  if (!issueRef) {
    return errorResponse(
      'Linear did not create the issue. The worker log has the API error.',
      502
    );
  }

  // createIssue writes linear_issue_id itself, so re-read rather than patching
  // the in-memory row and risking the two drifting apart.
  const updated = get<Suggestion>(
    `SELECT ${SUGGESTION_COLUMNS} FROM suggestions WHERE id = ?`,
    [suggestion.id]
  );
  return ok({ suggestion: updated ?? { ...suggestion, linear_issue_id: issueRef } });
}
