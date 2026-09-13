/**
 * GET /api/answers/[id]  ->  AnswerDetailResponse
 *
 * The full stored answer plus everything the detail page needs around it: the
 * query that produced it, the run date it belongs to, and its mentions joined
 * to brand names (with an isSelf flag so the UI can colour us differently).
 *
 * 404 when the id does not exist. Note that in Next 16 `context.params` is a
 * Promise and must be awaited.
 */
import { all, get, parseJson } from '@/lib/db';
import type {
  Answer,
  AnswerDetailResponse,
  AnswerStatus,
  Citation,
  Mention,
  ProviderId,
  Sentiment,
} from '@/lib/types';
import { NotFoundError, asProviderId, fail, ok, parseId } from '../../_lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AnswerRow {
  id: number;
  run_id: number;
  query_id: number;
  provider: string;
  model_id: string;
  status: string;
  answer_text: string | null;
  citations: string | null;
  other_brands: string | null;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
  query_text: string;
  run_date: string;
}

interface MentionRow {
  id: number;
  answer_id: number;
  brand_id: number;
  position: number;
  sentiment: number;
  quote: string | null;
  brand_name: string;
  is_self: number;
}

function asSentiment(value: number): Sentiment {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await context.params;
    const id = parseId(rawId);

    const row = get<AnswerRow>(
      `SELECT a.id, a.run_id, a.query_id, a.provider, a.model_id, a.status,
              a.answer_text, a.citations, a.other_brands, a.latency_ms,
              a.error, a.created_at,
              q.text AS query_text,
              r.run_date AS run_date
         FROM answers a
         JOIN queries q ON q.id = a.query_id
         JOIN runs r ON r.id = a.run_id
        WHERE a.id = ?`,
      [id]
    );

    if (!row) throw new NotFoundError(`No answer with id ${id}`);

    const mentionRows = all<MentionRow>(
      `SELECT m.id, m.answer_id, m.brand_id, m.position, m.sentiment, m.quote,
              b.name AS brand_name,
              b.is_self AS is_self
         FROM mentions m
         JOIN brands b ON b.id = m.brand_id
        WHERE m.answer_id = ?
        ORDER BY m.position ASC, m.id ASC`,
      [id]
    );

    const answer: Answer = {
      id: row.id,
      run_id: row.run_id,
      query_id: row.query_id,
      // The column is free text in SQLite; fall back rather than lying to TS.
      provider: (asProviderId(row.provider) ?? row.provider) as ProviderId,
      model_id: row.model_id,
      status: (row.status === 'error' ? 'error' : 'ok') as AnswerStatus,
      answer_text: row.answer_text,
      citations: parseJson<Citation[]>(row.citations, []),
      other_brands: parseJson<string[]>(row.other_brands, []),
      latency_ms: row.latency_ms,
      error: row.error,
      created_at: row.created_at,
    };

    const mentions: Array<Mention & { brandName: string; isSelf: boolean }> = mentionRows.map(
      (m) => ({
        id: m.id,
        answer_id: m.answer_id,
        brand_id: m.brand_id,
        position: m.position,
        sentiment: asSentiment(m.sentiment),
        quote: m.quote,
        brandName: m.brand_name,
        isSelf: m.is_self === 1,
      })
    );

    const data: AnswerDetailResponse = {
      answer,
      queryText: row.query_text,
      runDate: row.run_date,
      mentions,
    };

    return ok(data);
  } catch (err) {
    return fail(err);
  }
}
